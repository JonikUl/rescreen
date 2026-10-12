import { PNG } from "pngjs";

import type { Snapshot, SnapshotKey } from "../snapshot/types.js";

/** Цвет пикселя RGBA. */
export interface Rgba {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a?: number;
}

/** Создаёт одноцветное PNG-изображение заданного размера. */
export function createPng(
  width: number,
  height: number,
  fill: Rgba = { r: 255, g: 255, b: 255 },
): PNG {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      setPixel(png, x, y, fill);
    }
  }
  return png;
}

/** Закрашивает прямоугольную область изображения. */
export function fillRect(
  png: PNG,
  x0: number,
  y0: number,
  width: number,
  height: number,
  color: Rgba,
): PNG {
  for (let y = y0; y < y0 + height; y++) {
    for (let x = x0; x < x0 + width; x++) {
      setPixel(png, x, y, color);
    }
  }
  return png;
}

function setPixel(png: PNG, x: number, y: number, { r, g, b, a = 255 }: Rgba): void {
  const idx = (png.width * y + x) << 2;
  png.data[idx] = r;
  png.data[idx + 1] = g;
  png.data[idx + 2] = b;
  png.data[idx + 3] = a;
}

/** Кодирует PNG в байты. */
export function encodePng(png: PNG): Uint8Array {
  return new Uint8Array(PNG.sync.write(png));
}

/** Собирает Snapshot с заданным ключом и PNG-данными. */
export function makeSnapshot(
  key: SnapshotKey,
  png: Uint8Array,
  masksApplied: readonly string[] = [],
  capturedAt: Date = new Date("2026-10-11T12:00:00.000Z"),
): Snapshot {
  return { key, png, capturedAt, masksApplied };
}
