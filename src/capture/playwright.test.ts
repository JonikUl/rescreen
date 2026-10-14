import { createServer } from "node:http";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { PNG } from "pngjs";

import {
  createPlaywrightCapture,
  FRAME_STABILITY_INTERVAL_MS,
  FRAME_STABILITY_PROBES,
  FRAME_STABILITY_TIMEOUT_MS,
} from "./playwright.js";
import type { Capture, CaptureTarget } from "./types.js";

/**
 * Интеграционные тесты Capture против реального headless Chromium.
 * Поднимают локальный статический сервер с фикстурными страницами.
 * Пропускаются, если браузер недоступен: RESCREEN_SKIP_BROWSER=1.
 */

const PAGES: Record<string, string> = {
  "/js-anim.html": `<!doctype html>
<html><head><meta charset="utf-8"><style>
  body { margin: 0; font-family: system-ui, sans-serif; }
  #slider { width: 400px; height: 300px; background: #f0f0f0; }
</style></head><body>
  <div id="slider">кадр 0</div>
  <script>
    // JS-анимация, которая затихает: после 6 смен кадра слайдер останавливается.
    const slider = document.getElementById("slider");
    let frame = 0;
    const timer = setInterval(() => {
      frame += 1;
      slider.textContent = "кадр " + frame;
      if (frame >= 6) clearInterval(timer);
    }, 100);
  </script>
</body></html>`,
  "/css-pulse.html": `<!doctype html>
<html><head><meta charset="utf-8"><style>
  body { margin: 0; }
  #box { width: 200px; height: 200px; background: #e05038;
         animation: pulse 1.2s ease-in-out infinite; }
  @keyframes pulse {
    0%, 100% { transform: scale(1); opacity: 1; }
    50% { transform: scale(1.15); opacity: 0.6; }
  }
</style></head><body>
  <div id="box"></div>
</body></html>`,
  "/masked.html": `<!doctype html>
<html><head><meta charset="utf-8"><style>
  body { margin: 0; font-family: system-ui, sans-serif; }
  #content { width: 400px; height: 150px; background: #e0e0e0; }
  .clock { width: 400px; height: 100px; background: #d0d0ff; font-size: 32px; }
</style></head><body>
  <div id="content">статичный блок</div>
  <div class="clock">—</div>
  <script>
    // Блок никогда не стабилизируется сам — без маски каждый кадр новый.
    const clock = document.querySelector(".clock");
    setInterval(() => { clock.textContent = "тик " + Date.now(); }, 100);
  </script>
</body></html>`,
  "/never-stable.html": `<!doctype html>
<html><head><meta charset="utf-8"><style>
  body { margin: 0; font-family: system-ui, sans-serif; }
  #chaos { width: 400px; height: 300px; background: #f0f0f0; }
</style></head><body>
  <div id="chaos">0</div>
  <script>
    const el = document.getElementById("chaos");
    let n = 0;
    setInterval(() => { n += 1; el.textContent = "хаос " + n + " " + Math.random(); }, 50);
  </script>
</body></html>`,
  "/plain.html": `<!doctype html>
<html><head><meta charset="utf-8"><style>body { margin: 0; }</style></head>
<body><p>статичная страница</p></body></html>`,
};

const equalBytes = (a: Uint8Array, b: Uint8Array): boolean =>
  Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;

describe.skipIf(process.env.RESCREEN_SKIP_BROWSER === "1")(
  "PlaywrightCapture (реальный браузер)",
  () => {
    let server: Server;
    let baseUrl: string;
    let capture: Capture;

    beforeAll(async () => {
      server = createServer((req, res) => {
        const html = PAGES[new URL(req.url ?? "/", "http://localhost").pathname];
        if (html === undefined) {
          res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
          res.end("не найдено");
          return;
        }
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(html);
      });
      await new Promise<void>((resolve) => server.listen(0, resolve));
      const address = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${address.port}`;
      capture = await createPlaywrightCapture();
    });

    afterAll(async () => {
      await capture.dispose();
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    });

    const target = (path: string, overrides: Partial<CaptureTarget> = {}): CaptureTarget => ({
      key: { page: path, viewport: { width: 400, height: 300 } },
      url: `${baseUrl}${path}`,
      mask: [],
      ...overrides,
    });

    it(
      "ожидание стабильного кадра укрощает JS-анимацию: два подряд снятых Snapshot'а побайтово одинаковы",
      { timeout: 20_000 },
      async () => {
        const first = await capture.capture(target("/js-anim.html"));
        const second = await capture.capture(target("/js-anim.html"));

        expect(first.warnings).toEqual([]);
        expect(second.warnings).toEqual([]);
        expect(equalBytes(first.png, second.png)).toBe(true);
      },
    );

    it(
      "ожидание стабильного кадра применяется и к Snapshot'у элемента",
      { timeout: 20_000 },
      async () => {
        const element = { element: "#slider" };
        const first = await capture.capture(
          target("/js-anim.html", {
            key: { page: "/js-anim.html", viewport: { width: 400, height: 300 }, ...element },
          }),
        );
        const second = await capture.capture(
          target("/js-anim.html", {
            key: { page: "/js-anim.html", viewport: { width: 400, height: 300 }, ...element },
          }),
        );

        expect(first.warnings).toEqual([]);
        expect(equalBytes(first.png, second.png)).toBe(true);
      },
    );

    it(
      "CSS-анимации заморожены: кадры стабильны без предупреждений",
      { timeout: 20_000 },
      async () => {
        const first = await capture.capture(target("/css-pulse.html"));
        const second = await capture.capture(target("/css-pulse.html"));

        expect(first.warnings).toEqual([]);
        expect(second.warnings).toEqual([]);
        expect(equalBytes(first.png, second.png)).toBe(true);
      },
    );

    it(
      "меняющийся под маской блок не даёт расхождений; masksApplied — ровно внедрённые селекторы",
      { timeout: 20_000 },
      async () => {
        const t = target("/masked.html", { mask: [".clock"] });
        const first = await capture.capture(t);
        const second = await capture.capture(t);

        expect(first.warnings).toEqual([]);
        expect(first.masksApplied).toEqual([".clock"]);
        expect(equalBytes(first.png, second.png)).toBe(true);
      },
    );

    it(
      "замаскированная область помечена на снимке штриховкой: вся область — только цвета штрихов",
      { timeout: 20_000 },
      async () => {
        const snapshot = await capture.capture(target("/masked.html", { mask: [".clock"] }));
        const png = PNG.sync.read(Buffer.from(snapshot.png));

        // .clock: 400×100 под блоком #content высотой 150 → y ∈ [150, 250)
        const stripe = new Set(["b8b8b8", "d3d3d3"]);
        for (let y = 150; y < 250; y++) {
          for (let x = 0; x < 400; x++) {
            const idx = (png.width * y + x) << 2;
            const hex = png.data.subarray(idx, idx + 3).toString("hex");
            expect(stripe.has(hex), `пиксель (${x}, ${y}) = #${hex}`).toBe(true);
          }
        }
      },
    );

    it(
      "селектор маски без совпадений на странице не портит съёмку",
      { timeout: 20_000 },
      async () => {
        const t = target("/plain.html", { mask: [".not-on-page"] });
        const snapshot = await capture.capture(t);

        expect(snapshot.warnings).toEqual([]);
        expect(snapshot.masksApplied).toEqual([".not-on-page"]);
        expect(snapshot.png.length).toBeGreaterThan(0);
      },
    );

    it(
      "нестабильный до таймаута кадр: Snapshot возвращается с предупреждением, а не ошибкой",
      { timeout: 30_000 },
      async () => {
        const snapshot = await capture.capture(target("/never-stable.html"));

        expect(snapshot.png.length).toBeGreaterThan(0);
        expect(snapshot.warnings).toHaveLength(1);
        expect(snapshot.warnings[0]).toContain("Стабильный кадр");
        expect(snapshot.warnings[0]).toContain(String(FRAME_STABILITY_TIMEOUT_MS));
      },
    );

    it("дефолты стабильности кадра зафиксированы контрактом", () => {
      expect(FRAME_STABILITY_PROBES).toBe(3);
      expect(FRAME_STABILITY_INTERVAL_MS).toBe(300);
      expect(FRAME_STABILITY_TIMEOUT_MS).toBe(5000);
    });
  },
);
