import { resolveConfig } from "./loader.js";
import type { RescreenConfig, ResolvedPageConfig } from "./types.js";
import type { SnapshotKey } from "../snapshot/types.js";

/** Snapshot, заданный конфигом: ключ и Page, из которой он построен. */
export interface ConfiguredSnapshot {
  readonly key: SnapshotKey;
  readonly page: ResolvedPageConfig;
}

/** Страничные и элементные Snapshot'ы выбранных Page в порядке показа. */
export function configuredSnapshotsForPages(
  pages: readonly ResolvedPageConfig[],
): readonly ConfiguredSnapshot[] {
  return pages.flatMap((page) => [
    {
      key: { page: page.name, viewport: page.viewport },
      page,
    },
    ...page.elements.map((element) => ({
      key: { page: page.name, viewport: page.viewport, element },
      page,
    })),
  ]);
}

/** Ключи страничных и элементных Snapshot'ов resolved-конфига в порядке показа. */
export function configuredSnapshotKeys(config: RescreenConfig): readonly SnapshotKey[] {
  return configuredSnapshotsForPages(resolveConfig(config).pages).map(({ key }) => key);
}
