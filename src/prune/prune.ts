import { configuredSnapshotKeys } from "../config/snapshot-keys.js";
import type { RescreenConfig } from "../config/types.js";
import type { SnapshotKey } from "../snapshot/types.js";
import type { BaselineStorage } from "../storage/types.js";

export interface PruneOrphansDeps {
  readonly config: RescreenConfig;
  readonly storage: BaselineStorage;
  /** Только вернуть устаревшие ключи, не удаляя артефакты. */
  readonly dryRun?: boolean;
}

/**
 * Находит все per-key артефакты вне resolved-конфига и удаляет их, если не включён dryRun.
 * Возвращает отсортированные устаревшие ключи в режиме предпросмотра и после удаления.
 */
export async function pruneOrphans(deps: PruneOrphansDeps): Promise<readonly SnapshotKey[]> {
  return deps.storage.pruneSnapshots(configuredSnapshotKeys(deps.config), {
    dryRun: deps.dryRun === true,
  });
}
