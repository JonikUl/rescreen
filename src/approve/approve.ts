import type { Approver, ApproveResult } from "./types.js";
import type { BaselineStorage } from "../storage/types.js";
import type { Snapshot } from "../snapshot/types.js";

export interface ApproverDeps {
  readonly storage: BaselineStorage;
}

/**
 * Реализация {@link Approver}: workflow команды `rescreen approve` поверх BaselineStorage.
 * Кандидаты — ключи с Diff-файлами ({@link BaselineStorage.listPendingDiffs}, ADR-0003):
 * ни результат последнего Run'а, ни конфиг не читаются.
 */
export function createApprover(deps: ApproverDeps): Approver {
  const { storage } = deps;

  return {
    async approve(pageNames?: readonly string[]): Promise<ApproveResult> {
      const unapproved = await storage.listUnapprovedDiffs();
      const wanted =
        pageNames !== undefined && pageNames.length > 0 ? new Set(pageNames) : undefined;
      const keys = wanted === undefined ? unapproved : unapproved.filter((k) => wanted.has(k.page));

      const approved: Snapshot[] = [];
      for (const key of keys) {
        approved.push(await storage.approve(key));
      }
      return { approved };
    },
  };
}
