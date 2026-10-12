import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";

import { DimensionMismatchError } from "./types.js";
import type { DiffEngine, DiffResult } from "./types.js";

/**
 * DiffEngine поверх pixelmatch: попиксельное сравнение двух PNG.
 * Идентичные изображения дают `ratio === 0` и `diffPng === null`;
 * разные размеры — {@link DimensionMismatchError}.
 */
export function createPixelmatchDiffEngine(): DiffEngine {
  return {
    async compare(baselinePng: Uint8Array, currentPng: Uint8Array): Promise<DiffResult> {
      const baseline = PNG.sync.read(Buffer.from(baselinePng));
      const current = PNG.sync.read(Buffer.from(currentPng));

      if (baseline.width !== current.width || baseline.height !== current.height) {
        throw new DimensionMismatchError(
          `Размеры изображений не совпадают: Baseline ${baseline.width}×${baseline.height}, ` +
            `текущий ${current.width}×${current.height}`,
        );
      }

      const { width, height } = baseline;
      const diff = new PNG({ width, height });
      const diffPixels = pixelmatch(baseline.data, current.data, diff.data, width, height);
      const totalPixels = width * height;

      return {
        diffPixels,
        totalPixels,
        ratio: totalPixels === 0 ? 0 : diffPixels / totalPixels,
        diffPng: diffPixels === 0 ? null : new Uint8Array(PNG.sync.write(diff)),
      };
    },
  };
}
