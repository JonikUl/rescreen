import { PNG } from "pngjs";
import { describe, expect, it } from "vite-plus/test";

import { DimensionMismatchError } from "./types.js";
import { createPixelmatchDiffEngine } from "./pixelmatch.js";
import { createPng, encodePng, fillRect } from "../test-utils/png.js";

const engine = createPixelmatchDiffEngine();

describe("DiffEngine (pixelmatch)", () => {
  it("идентичные изображения: ratio 0, diffPng null", async () => {
    const png = encodePng(createPng(8, 6, { r: 10, g: 20, b: 30 }));
    const result = await engine.compare(png, png);

    expect(result.diffPixels).toBe(0);
    expect(result.ratio).toBe(0);
    expect(result.totalPixels).toBe(48);
    expect(result.diffPng).toBeNull();
  });

  it("отличается один пиксель: diffPixels 1, ratio 1/totalPixels, diffPng задан", async () => {
    const baseline = createPng(8, 6, { r: 0, g: 0, b: 0 });
    const current = createPng(8, 6, { r: 0, g: 0, b: 0 });
    fillRect(current, 3, 2, 1, 1, { r: 255, g: 255, b: 255 });

    const result = await engine.compare(encodePng(baseline), encodePng(current));

    expect(result.diffPixels).toBe(1);
    expect(result.totalPixels).toBe(48);
    expect(result.ratio).toBeCloseTo(1 / 48, 10);
    expect(result.diffPng).not.toBeNull();
    const diffDecoded = PNG.sync.read(Buffer.from(result.diffPng as Uint8Array));
    expect(diffDecoded.width).toBe(8);
    expect(diffDecoded.height).toBe(6);
  });

  it("отличается прямоугольная область: diffPixels равны площади области", async () => {
    const baseline = createPng(20, 20, { r: 0, g: 0, b: 0 });
    const current = createPng(20, 20, { r: 0, g: 0, b: 0 });
    fillRect(current, 5, 5, 10, 10, { r: 255, g: 255, b: 255 });

    const result = await engine.compare(encodePng(baseline), encodePng(current));

    expect(result.diffPixels).toBe(100);
    expect(result.ratio).toBeCloseTo(100 / 400, 10);
  });

  it("разные размеры: DimensionMismatchError", async () => {
    const baseline = encodePng(createPng(8, 6));
    const current = encodePng(createPng(9, 6));

    await expect(engine.compare(baseline, current)).rejects.toThrow(DimensionMismatchError);
  });

  it("чувствительность максимальна: оттенок 1/255 уже считается расхождением", async () => {
    const baseline = encodePng(createPng(4, 4, { r: 10, g: 10, b: 10 }));
    const current = encodePng(createPng(4, 4, { r: 11, g: 10, b: 10 }));

    const result = await engine.compare(baseline, current);

    expect(result.diffPixels).toBe(16);
    expect(result.ratio).toBe(1);
  });

  it("инвариант чистоты: повторный вызов с теми же байтами даёт тот же ratio", async () => {
    const baseline = encodePng(createPng(8, 6, { r: 1, g: 2, b: 3 }));
    const current = encodePng(
      fillRect(createPng(8, 6, { r: 1, g: 2, b: 3 }), 0, 0, 4, 3, { r: 200, g: 0, b: 0 }),
    );

    const first = await engine.compare(baseline, current);
    const second = await engine.compare(baseline, current);

    expect(second.ratio).toBe(first.ratio);
    expect(second.diffPixels).toBe(first.diffPixels);
  });
});
