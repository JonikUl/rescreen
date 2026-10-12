import type { Approver, ApproveResult } from "./types.js";
import type { BaselineStorage } from "../storage/types.js";
import type { Snapshot, SnapshotKey } from "../snapshot/types.js";

export interface ApproverDeps {
  readonly storage: BaselineStorage;
}

/** Реализация {@link Approver}: workflow команды `rescreen approve` поверх BaselineStorage. */
export function createApprover(deps: ApproverDeps): Approver {
  const { storage } = deps;

  return {
    async approve(pageNames?: readonly string[]): Promise<ApproveResult> {
      const lastRun = await storage.getLastRunResult();
      if (!lastRun) {
        // До первого Run'а проверить имена негде: любое имя — неизвестное
        if (pageNames !== undefined && pageNames.length > 0) {
          throw new Error(
            `Неизвестные Page: ${pageNames.join(", ")} — прогонов ещё не было, сначала выполните run.`,
          );
        }
        return { approved: [] };
      }

      let diffs = lastRun.results.filter((r) => r.status === "diff");
      if (pageNames !== undefined && pageNames.length > 0) {
        const known = new Set(lastRun.results.map((r) => r.key.page));
        const unknown = pageNames.filter((name) => !known.has(name));
        if (unknown.length > 0) {
          throw new Error(`Неизвестные Page: ${unknown.join(", ")} — их нет в последнем прогоне`);
        }
        const wanted = new Set(pageNames);
        diffs = diffs.filter((r) => wanted.has(r.key.page));
      }

      const approved: Snapshot[] = [];
      for (const diff of diffs) {
        if (await isAlreadyApproved(diff.key)) continue;
        approved.push(await storage.approve(diff.key));
      }
      return { approved };
    },
  };

  /** Diff уже подтверждён прошлым Approve: текущий Snapshot побайтово равен Baseline'у. */
  async function isAlreadyApproved(key: SnapshotKey): Promise<boolean> {
    const [baseline, current] = await Promise.all([
      storage.getBaseline(key),
      storage.getCurrent(key),
    ]);
    if (!baseline || !current) return false;
    return Buffer.from(baseline.png).equals(Buffer.from(current.png));
  }
}
