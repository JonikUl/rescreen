#!/usr/bin/env node
import { join } from "node:path";

import { ConfigError } from "./config/types.js";
import { loadConfig, resolveConfig } from "./config/loader.js";
import { createPlaywrightCapture } from "./capture/playwright.js";
import type { Capture } from "./capture/types.js";
import { createPixelmatchDiffEngine } from "./diff/pixelmatch.js";
import { createFileStorage } from "./storage/file.js";
import { createRunner } from "./runner/runner.js";
import { toExitCode } from "./runner/exit-code.js";
import { createApprover } from "./approve/approve.js";
import { createHtmlReporter } from "./report/html.js";
import type { RunResult, SnapshotResult } from "./runner/types.js";
import type { SnapshotKey } from "./snapshot/types.js";

const USAGE = `rescreen — визуальное регрессионное тестирование

Использование:
  rescreen run [page...]      снять Snapshot'ы и сравнить с Baseline'ами
                              (без аргументов — все Page из конфига)
  rescreen approve [page...]  подтвердить Diff'ы последнего прогона:
                              текущие Snapshot'ы становятся Baseline'ами
                              (без аргументов — все Page с Diff'ами)

Команды init, open появятся в следующих тикетах.`;

async function run(pageNames: readonly string[]): Promise<number> {
  let capture: Capture | null = null;
  try {
    const config = await loadConfig(process.cwd());
    const resolved = resolveConfig(config);
    const storage = createFileStorage();
    capture = await createPlaywrightCapture();
    const reportPath = join(storage.rootDir, "report.html");
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
    if (err instanceof ConfigError) {
      console.error(`Ошибка конфигурации: ${err.message}`);
    } else {
      console.error(`Ошибка: ${err instanceof Error ? err.message : String(err)}`);
    }
    return 2;
  } finally {
    if (capture !== null) {
      await capture.dispose().catch(() => {});
    }
  }
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
    console.error(`Ошибка: ${err instanceof Error ? err.message : String(err)}`);
    return 2;
  }
}

function printSummary(result: RunResult, reportPath: string): void {
  const s = result.summary;
  console.log("rescreen: прогон завершён");
  console.log(
    `Проверено ${s.pages} страниц (${s.total} снимков): без изменений ${s.unchanged}, изменилось ${s.diffs}, новых ${s.newBaselines}, пропущено ${s.skipped}, ошибок ${s.errors}`,
  );
  for (const r of result.results) {
    console.log(`  ${describeResult(r)}`);
    if (r.warning !== undefined && r.status !== "error" && r.status !== "skipped") {
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
      return `${title} — ПРОПУЩЕН: ${result.warning ?? "элемент не найден"}`;
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
  if (command === "init" || command === "open") {
    console.error(`rescreen ${command}: команда появится в следующих тикетах.`);
    return 2;
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
