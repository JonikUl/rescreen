import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { join } from "node:path";

import { createFileStorage } from "../storage/file.js";
import type { FileBaselineStorage } from "../storage/file.js";

export interface OpenReportDeps {
  /** Хранилище последнего Report'а; по умолчанию — `.rescreen` текущей директории. */
  readonly storage?: FileBaselineStorage;
  /** Открывает файл в системном браузере; по умолчанию — xdg-open/open/start. */
  readonly opener?: (path: string) => Promise<void>;
}

export interface OpenReportResult {
  readonly ok: boolean;
  readonly message: string;
}

/** Путь к Report'у последнего Run'а в хранилище. */
export function reportPathFor(storage: FileBaselineStorage): string {
  return join(storage.rootDir, "report.html");
}

/**
 * Команда `rescreen open`: открывает последний Report в системном браузере.
 * Если Report'а нет (Run'ов ещё не было) — понятное сообщение, браузер не вызывается.
 */
export async function openReport(deps: OpenReportDeps = {}): Promise<OpenReportResult> {
  const storage = deps.storage ?? createFileStorage();
  const opener = deps.opener ?? systemOpener;
  const reportPath = reportPathFor(storage);

  try {
    await access(reportPath);
  } catch {
    return {
      ok: false,
      message: `Отчёт не найден (${reportPath}) — сначала выполните rescreen run.`,
    };
  }

  try {
    await opener(reportPath);
  } catch (err) {
    return {
      ok: false,
      message: `Не удалось открыть браузер: ${err instanceof Error ? err.message : String(err)}. Откройте файл вручную: ${reportPath}`,
    };
  }
  return { ok: true, message: `Отчёт открыт в браузере: ${reportPath}` };
}

/** Открытие файла системным браузером: detached-процесс, CLI его не дожидается. */
function systemOpener(path: string): Promise<void> {
  const [command, args] =
    process.platform === "darwin"
      ? ["open", [path]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", path]]
        : ["xdg-open", [path]];

  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    child.once("error", rejectPromise);
    child.once("spawn", () => {
      child.unref();
      resolvePromise();
    });
  });
}
