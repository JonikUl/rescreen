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
import { createHtmlReporter } from "./report/html.js";
import type { RunResult, SnapshotResult } from "./runner/types.js";

const USAGE = `rescreen — визуальное регрессионное тестирование

Использование:
  rescreen run [page...]  снять Snapshot'ы и сравнить с Baseline'ами
                          (без аргументов — все Page из конфига)

Команды init, approve, open появятся в следующих тикетах.`;

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

function printSummary(result: RunResult, reportPath: string): void {
  const s = result.summary;
  console.log("rescreen: прогон завершён");
  console.log(
    `Проверено ${s.total} страниц: без изменений ${s.unchanged}, изменилось ${s.diffs}, новых ${s.newBaselines}, ошибок ${s.errors}`,
  );
  for (const r of result.results) {
    console.log(`  ${describeResult(r)}`);
    if (r.warning !== undefined && r.status !== "error") {
      console.log(`    ⚠ ${r.warning}`);
    }
  }
  console.log(`Отчёт: ${reportPath}`);
}

function describeResult(result: SnapshotResult): string {
  const key = result.key;
  const title = `${key.page} (${key.viewport.width}×${key.viewport.height}${key.element === undefined ? "" : ` :: ${key.element}`})`;
  switch (result.status) {
    case "unchanged":
      return `${title} — без изменений`;
    case "diff":
      return `${title} — ИЗМЕНИЛОСЬ (${((result.diffRatio ?? 0) * 100).toFixed(2)}% пикселей)`;
    case "new-baseline":
      return `${title} — создан новый Baseline`;
    case "error":
      return `${title} — ОШИБКА: ${result.error ?? "неизвестная ошибка"}`;
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
  if (command === "init" || command === "approve" || command === "open") {
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
