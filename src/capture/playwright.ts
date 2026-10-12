import { chromium } from "playwright";
import type { Browser, Page } from "playwright";

import { ElementNotFoundError } from "./types.js";
import type { Capture, CaptureTarget } from "./types.js";
import type { Snapshot } from "../snapshot/types.js";

/**
 * Ожидание стабильного кадра: сколько одинаковых подряд скриншотов
 * (побайтовое сравнение PNG) считаем стабильным кадром.
 */
export const FRAME_STABILITY_PROBES = 3;
/** Интервал между пробами кадра при ожидании стабильности, мс. */
export const FRAME_STABILITY_INTERVAL_MS = 300;
/** Общий таймаут ожидания стабильного кадра, мс; при превышении — последний кадр + предупреждение. */
export const FRAME_STABILITY_TIMEOUT_MS = 5000;

/**
 * CSS-стабилизация, применяемая на каждой странице перед съёмкой:
 * CSS-анимации и переходы отключены (иначе «пульсирующие» элементы дают ложные Diff'ы).
 * Маскирование — одно правило на селектор: `visibility: hidden !important`.
 * Правила внедряются целиком, поэтому селекторы без совпадений на странице
 * просто не срабатывают и съёмку не портят.
 */
function stabilizationCss(mask: readonly string[]): string {
  const maskRules = mask
    .map((selector) => `${selector} { visibility: hidden !important; }`)
    .join("\n");
  return `
*, *::before, *::after {
  animation: none !important;
  transition: none !important;
}
${maskRules}
`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Снимает кадры до тех пор, пока {@link FRAME_STABILITY_PROBES} подряд проб
 * не окажутся побайтово одинаковыми, но не дольше {@link FRAME_STABILITY_TIMEOUT_MS}.
 * Возвращает последний кадр и предупреждения (пустые, если кадр стабилизировался).
 */
async function shootStableFrame(shoot: () => Promise<Buffer>): Promise<{
  png: Buffer;
  warnings: string[];
}> {
  const deadline = Date.now() + FRAME_STABILITY_TIMEOUT_MS;
  let last = await shoot();
  let identicalInRow = 1;

  while (identicalInRow < FRAME_STABILITY_PROBES) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      return {
        png: last,
        warnings: [
          `Стабильный кадр не достигнут за ${FRAME_STABILITY_TIMEOUT_MS} мс — используется последний кадр`,
        ],
      };
    }
    await sleep(Math.min(FRAME_STABILITY_INTERVAL_MS, remaining));
    const next = await shoot();
    if (Buffer.compare(last, next) === 0) {
      identicalInRow += 1;
    } else {
      last = next;
      identicalInRow = 1;
    }
  }
  return { png: last, warnings: [] };
}

/**
 * Capture поверх реального headless Chromium (Playwright).
 * Браузер поднимается лениво, один на все capture; `dispose` идемпотентен.
 */
export async function createPlaywrightCapture(): Promise<Capture> {
  let browserPromise: Promise<Browser> | null = null;
  let disposed = false;

  const browser = (): Promise<Browser> => {
    if (disposed) {
      throw new Error("Capture уже освобождён через dispose()");
    }
    browserPromise ??= chromium.launch();
    return browserPromise;
  };

  return {
    async capture(target: CaptureTarget): Promise<Snapshot> {
      if (disposed) {
        throw new Error("Capture уже освобождён через dispose()");
      }
      const context = await (await browser()).newContext({ viewport: target.key.viewport });
      try {
        const page = await context.newPage();
        await page.goto(target.url, { waitUntil: "networkidle" });
        await page.addStyleTag({ content: stabilizationCss(target.mask) });

        const shoot = (): Promise<Buffer> =>
          target.key.element
            ? captureElement(page, target.key.element, target.key.page)
            : page.screenshot({ fullPage: true });

        const { png, warnings } = await shootStableFrame(shoot);

        return {
          key: target.key,
          png: new Uint8Array(png),
          capturedAt: new Date(),
          masksApplied: target.mask,
          warnings,
        };
      } finally {
        await context.close();
      }
    },

    async dispose(): Promise<void> {
      if (disposed) return;
      disposed = true;
      if (!browserPromise) return;
      try {
        await (await browserPromise).close();
      } catch {
        // браузер мог и не запуститься — dispose всё равно идемпотентен
      }
    },
  };
}

async function captureElement(page: Page, selector: string, pageName: string): Promise<Buffer> {
  const locator = page.locator(selector);
  if ((await locator.count()) === 0) {
    throw new ElementNotFoundError(selector, pageName);
  }
  return locator.screenshot();
}
