import { chromium } from "playwright";
import type { Browser, Page } from "playwright";

import { ElementNotFoundError } from "./types.js";
import type { Capture, CaptureTarget } from "./types.js";
import type { Snapshot } from "../snapshot/types.js";

/**
 * CSS-стабилизация, применяемая на каждой странице перед съёмкой:
 * CSS-анимации и переходы отключены (иначе «пульсирующие» элементы дают ложные Diff'ы).
 * Маскирование — одно правило на селектор: `visibility: hidden !important`
 * (минимально честная реализация masksApplied; ticket 03 ужесточает).
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

        const png = target.key.element
          ? await captureElement(page, target.key.element, target.key.page)
          : await page.screenshot({ fullPage: true });

        return {
          key: target.key,
          png: new Uint8Array(png),
          capturedAt: new Date(),
          masksApplied: target.mask,
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
