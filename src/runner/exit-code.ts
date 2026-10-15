import type { RunResult } from "./types.js";

/**
 * Отображение результата Run'а на exit-код CLI:
 * errors > 0 → 2; иначе diffs > 0 → 1; иначе 0.
 * Пропущенные Snapshot'ы (skipped) на exit-код не влияют.
 */
export function toExitCode(result: RunResult): 0 | 1 | 2 {
  if (result.summary.errors > 0) return 2;
  if (result.summary.diffs > 0) return 1;
  return 0;
}
