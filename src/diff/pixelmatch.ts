import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";

import { DimensionMismatchError } from "./types.js";
import type { DiffEngine, DiffResult } from "./types.js";

/**
 * DiffEngine поверх pixelmatch: попиксельное сравнение двух PNG.
 * Идентичные изображения дают `ratio === 0` и `diffPng === null`;
 * разные размеры — {@link DimensionMismatchError}.
 *
 * Чувствительность: pixelmatch запускается с `threshold: 0` (максимальная —
 * оттенок 1/255 уже считается расхождением), чтобы единственной ручкой
 * чувствительности оставался Threshold из конфига (доля пикселей).
 * Обработка антиалиасинга — по умолчанию (AA-пиксели не считаются расхождением):
 * это антифлейк, соответствующий целям стабилизации.
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
      const diffPixels = pixelmatch(baseline.data, current.data, diff.data, width, height, {
        threshold: 0,
      });
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
