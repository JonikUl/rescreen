import { configuredSnapshotKeys } from "../config/snapshot-keys.js";
import type { RescreenConfig } from "../config/types.js";
import type { SnapshotResult } from "../runner/types.js";
import { snapshotKeyId } from "../snapshot/key.js";
import type { SnapshotKey } from "../snapshot/types.js";
import type { BaselineStorage } from "../storage/types.js";

/** Одна строка доски Status: configured SnapshotKey и его последнее состояние, если оно есть. */
export interface StatusEntry {
  readonly key: SnapshotKey;
  readonly state: SnapshotResult | null;
}

export interface StatusBoardDeps {
  readonly config: RescreenConfig;
  readonly storage: BaselineStorage;
}

/**
 * Возвращает доску актуального состояния для ключей resolved-конфига.
 *
 * Порядок: Page в порядке конфига; внутри Page сначала страничный Snapshot, затем Element'ы
 * в порядке конфига. Ключи вне конфига не возвращаются; отсутствующее состояние — null.
 * Инвариант: чистое чтение, никакой миграции существующих артефактов.
 */
export async function getStatusBoard(deps: StatusBoardDeps): Promise<readonly StatusEntry[]> {
  const states = new Map(
    (await deps.storage.listSnapshotStates()).map((state) => [snapshotKeyId(state.key), state]),
  );
  return configuredSnapshotKeys(deps.config).map((key) => ({
    key,
    state: states.get(snapshotKeyId(key)) ?? null,
  }));
}
