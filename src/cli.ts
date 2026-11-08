#!/usr/bin/env node
import { ConfigError } from "./config/types.js";
import { loadConfig, resolveConfig } from "./config/loader.js";
import { initProject } from "./config/init.js";
import { createPlaywrightCapture } from "./capture/playwright.js";
import type { Capture } from "./capture/types.js";
import { createPixelmatchDiffEngine } from "./diff/pixelmatch.js";
import { createFileStorage } from "./storage/file.js";
import { createRunner } from "./runner/runner.js";
import { toExitCode } from "./runner/exit-code.js";
import { createApprover } from "./approve/approve.js";
import { createHtmlReporter } from "./report/html.js";
import { openReport, reportPathFor } from "./report/open.js";
import { pruneOrphans } from "./prune/prune.js";
import { getStatusBoard } from "./status/status.js";
import type { StatusEntry } from "./status/status.js";
import { formatSummaryLine } from "./text/plural.js";
import type { RunResult, SnapshotResult } from "./runner/types.js";
import type { SnapshotKey } from "./snapshot/types.js";

const USAGE = `rescreen — визуальное регрессионное тестирование

Использование:
  rescreen init               создать rescreen.config.ts с примером и директорию .rescreen/
  rescreen run [page...]      снять Snapshot'ы и сравнить с Baseline'ами
                              (без аргументов — все Page из конфига)
  rescreen approve [page...]  подтвердить неподтверждённые Diff'ы:
                              текущие Snapshot'ы становятся Baseline'ами
                              (без аргументов — все неподтверждённые)
  rescreen status             показать актуальное состояние всех Page из конфига
  rescreen prune [--dry-run]  удалить per-key артефакты, которых нет в конфиге
                              (--dry-run — только показать устаревшие ключи)
  rescreen open               открыть последний Report в браузере`;

async function run(pageNames: readonly string[]): Promise<number> {
  let capture: Capture | null = null;
  try {
    const config = await loadConfig(process.cwd());
    const resolved = resolveConfig(config);
    const storage = createFileStorage();
    capture = await createPlaywrightCapture();
    const reportPath = reportPathFor(storage);
    const runner = createRunner({
      config: resolved,
      capture,
      diffEngine: createPixelmatchDiffEngine(),
      storage,
      reporter: createHtmlReporter(reportPath, { storage }),
    });

    const result = await runner.run(pageNames);
    printSummary(result, reportPath);
    return toExitCode(result);
  } catch (err) {
    return reportError(err);
  } finally {
    if (capture !== null) {
      await capture.dispose().catch(() => {});
    }
  }
}

function reportError(err: unknown): number {
  const detail = err instanceof Error ? err.message : String(err);
  const message =
    err instanceof ConfigError ? `Ошибка конфигурации: ${detail}` : `Ошибка: ${detail}`;
  console.error(message);
  return 2;
}

function describeKey(key: SnapshotKey): string {
  return `${key.page} (${key.viewport.width}×${key.viewport.height}${key.element === undefined ? "" : ` :: ${key.element}`})`;
}

async function approve(pageNames: readonly string[]): Promise<number> {
  try {
    const storage = createFileStorage();
    const approver = createApprover({ storage });
    const result = await approver.approve(pageNames);

    if (result.approved.length === 0) {
      console.log("rescreen: нечего аппрувить — неподтверждённых изменений нет.");
      return 0;
    }
    const pages = new Set(result.approved.map((s) => s.key.page)).size;
    console.log(
      `rescreen: подтверждено снимков: ${result.approved.length} (страниц: ${pages}) — они стали новыми Baseline'ами`,
    );
    for (const s of result.approved) {
      console.log(`  ${describeKey(s.key)}`);
    }
    return 0;
  } catch (err) {
    return reportError(err);
  }
}

async function init(): Promise<number> {
  try {
    const result = await initProject(process.cwd());
    if (result.configCreated) {
      console.log("rescreen: создан rescreen.config.ts — укажите baseUrl и список Page");
    } else {
      console.log("rescreen: конфиг уже существует — не перезаписываю");
    }
    console.log(`rescreen: директория хранилища: ${result.storageDir}`);
    console.log("Дальше: rescreen run");
    return 0;
  } catch (err) {
    return reportError(err);
  }
}

async function open(): Promise<number> {
  const storage = createFileStorage();
  const result = await openReport({ storage });
  if (result.ok) {
    console.log(result.message);
    return 0;
  }
  console.error(result.message);
  return 2;
}

async function status(): Promise<number> {
  try {
    const config = await loadConfig(process.cwd());
    const storage = createFileStorage();
    const board = await getStatusBoard({ config, storage });
    console.log("rescreen: актуальное состояние Page");
    for (const entry of board) {
      console.log(`  ${describeStatusEntry(entry)}`);
      if (entry.state?.warning !== undefined) {
        console.log(`    ⚠ ${entry.state.warning}`);
      }
    }
    return 0;
  } catch (err) {
    return reportError(err);
  }
}

function describeStatusEntry(entry: StatusEntry): string {
  const title = describeKey(entry.key);
  const state = entry.state;
  if (state === null) return `${title} — нет данных`;
  const timestamp =
    state.capturedAt === undefined
      ? `Проверено: ${state.attemptedAt.toISOString()}`
      : `Снято: ${state.capturedAt.toISOString()}`;
  switch (state.status) {
    case "unchanged":
      return `${title} — без изменений; ${timestamp}`;
    case "diff":
      return `${title} — есть Diff (${((state.diffRatio ?? 0) * 100).toFixed(2)}% пикселей); ${timestamp}`;
    case "new-baseline":
      return `${title} — без изменений (создан Baseline); ${timestamp}`;
    case "skipped":
      return `${title} — ПРОПУЩЕН; ${timestamp}`;
    case "error":
      return `${title} — ОШИБКА: ${state.error ?? "неизвестная ошибка"}; ${timestamp}`;
    default: {
      const unknown: never = state.status;
      throw new Error(`Неизвестный статус SnapshotResult: ${String(unknown)}`);
    }
  }
}

async function prune(args: readonly string[]): Promise<number> {
  const unknown = args.filter((arg) => arg !== "--dry-run");
  if (unknown.length > 0) {
    console.error(`Неизвестные аргументы prune: ${unknown.join(", ")}`);
    return 2;
  }
  const dryRun = args.includes("--dry-run");
  try {
    const config = await loadConfig(process.cwd());
    const storage = createFileStorage();
    const keys = await pruneOrphans({ config, storage, dryRun });
    if (keys.length === 0) {
      console.log("rescreen: устаревших Snapshot'ов нет — нечего удалять.");
      return 0;
    }
    console.log(
      dryRun
        ? "rescreen: устаревшие Snapshot'ы (предпросмотр, ничего не удалено):"
        : "rescreen: удалены устаревшие Snapshot'ы:",
    );
    for (const key of keys) {
      console.log(`  ${describeKey(key)}`);
    }
    if (dryRun) console.log("Для удаления выполните: rescreen prune");
    return 0;
  } catch (err) {
    return reportError(err);
  }
}

function printSummary(result: RunResult, reportPath: string): void {
  console.log("rescreen: прогон завершён");
  console.log(formatSummaryLine(result.summary));
  for (const r of result.results) {
    console.log(`  ${describeResult(r)}`);
    if (r.warning !== undefined) {
      console.log(`    ⚠ ${r.warning}`);
    }
  }
  console.log(`Отчёт: ${reportPath}`);
}

function describeResult(result: SnapshotResult): string {
  const title = describeKey(result.key);
  switch (result.status) {
    case "unchanged":
      return `${title} — без изменений`;
    case "diff":
      return `${title} — ИЗМЕНИЛОСЬ (${((result.diffRatio ?? 0) * 100).toFixed(2)}% пикселей)`;
    case "new-baseline":
      return `${title} — создан новый Baseline`;
    case "skipped":
      return `${title} — ПРОПУЩЕН`;
    case "error":
      return `${title} — ОШИБКА: ${result.error ?? "неизвестная ошибка"}`;
    default: {
      // Страховка от неисчерпывающего свитча при добавлении нового статуса
      const unknown: never = result.status;
      throw new Error(`Неизвестный статус SnapshotResult: ${String(unknown)}`);
    }
  }
}

async function main(): Promise<number> {
  const [command, ...rest] = process.argv.slice(2);

  if (command === undefined) {
    console.error(USAGE);
    return 2;
  }
  if (command === "--help" || command === "-h" || command === "help") {
    console.log(USAGE);
    return 0;
  }
  if (command === "run") {
    return run(rest);
  }
  if (command === "approve") {
    return approve(rest);
  }
  if (command === "status") {
    return status();
  }
  if (command === "prune") {
    return prune(rest);
  }
  if (command === "open") {
    return open();
  }
  if (command === "init") {
    return init();
  }
  console.error(`Неизвестная команда "${command}".\n\n${USAGE}`);
  return 2;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 2;
  },
);
