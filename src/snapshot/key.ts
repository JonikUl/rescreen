import type { SnapshotKey } from "./types.js";

/** Стабильная строковая идентичность SnapshotKey для слияния и сравнения состояний. */
export function snapshotKeyId(key: SnapshotKey): string {
  return JSON.stringify([key.page, key.viewport.width, key.viewport.height, key.element ?? null]);
}
