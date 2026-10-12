import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { createRunner } from "./runner.js";
import { toExitCode } from "./exit-code.js";
import { ElementNotFoundError } from "../capture/types.js";
import { resolveConfig } from "../config/loader.js";
import { createPixelmatchDiffEngine } from "../diff/pixelmatch.js";
import { createFileStorage } from "../storage/file.js";
import { createHtmlReporter } from "../report/html.js";
import { createPng, encodePng, fillRect } from "../test-utils/png.js";
import type { Capture, CaptureTarget } from "../capture/types.js";
import type { Snapshot } from "../snapshot/types.js";
import type { RunResult } from "./types.js";

/** Фейковый Capture: отдаёт PNG-фикстуры, умеет «падать» и «предупреждать» для заданных целей. */
class FakeCapture implements Capture {
  readonly targets: CaptureTarget[] = [];
  failures = new Map<string, Error>();
  warnings = new Map<string, readonly string[]>();

  constructor(private fixtures: Map<string, Uint8Array>) {}

  async capture(target: CaptureTarget): Promise<Snapshot> {
    this.targets.push(target);
    // Ключ фикстуры/сбоя: селектор для элементных целей, имя Page — для страничных.
    const id = target.key.element ?? target.key.page;
    const failure = this.failures.get(id);
    if (failure) throw failure;
    const png = this.fixtures.get(id);
    if (!png) throw new Error(`Нет фикстуры для цели "${id}"`);
    return {
      key: target.key,
      png,
      capturedAt: new Date(),
      masksApplied: target.mask,
      warnings: this.warnings.get(id) ?? [],
    };
  }

  async dispose(): Promise<void> {}
}

const config = resolveConfig({
  baseUrl: "https://example.com",
  mask: [".cookie-banner"],
  pages: [
    { name: "home", path: "/" },
    { name: "about", path: "/about", mask: ["#consultant-widget"] },
  ],
});

const solid = (r: number, g: number, b: number, size = 20) =>
  encodePng(createPng(size, size, { r, g, b }));

function fixtures(...entries: Array<[string, Uint8Array]>): Map<string, Uint8Array> {
  return new Map(entries);
}

/** Собирает Runner с файловым хранилищем и HTML-Reporter'ом во временной директории. */
async function setupRunner(
  storageDir: string,
  reportPath: string,
  capture: FakeCapture,
  cfg: Parameters<typeof resolveConfig>[0] = config,
) {
  const storage = createFileStorage(storageDir);
  const reporter = createHtmlReporter(reportPath, { storage });
  const runner = createRunner({
    config: resolveConfig(cfg),
    capture,
    diffEngine: createPixelmatchDiffEngine(),
    storage,
    reporter,
  });
  return { runner, storage };
}

describe("Runner (конвейер Run'а через фейковый Capture)", () => {
  let root: string;
  let storageDir: string;
  let reportPath: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "rescreen-runner-"));
    storageDir = join(root, ".rescreen");
    reportPath = join(root, "report.html");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const invariant = (result: RunResult) => {
    const s = result.summary;
    expect(s.total).toBe(s.unchanged + s.diffs + s.newBaselines + s.skipped + s.errors);
    expect(s.total).toBe(result.results.length);
    expect(s.pages).toBeLessThanOrEqual(s.total);
  };

  it("первый Run создаёт Baseline'ы автоматически и возвращает сводку", async () => {
    const capture = new FakeCapture(
      fixtures(["home", solid(255, 0, 0)], ["about", solid(0, 255, 0)]),
    );
    const { runner, storage } = await setupRunner(storageDir, reportPath, capture);

    const result = await runner.run();

    expect(result.results.map((r) => r.status)).toEqual(["new-baseline", "new-baseline"]);
    expect(result.summary).toEqual({
      pages: 2,
      total: 2,
      unchanged: 0,
      diffs: 0,
      newBaselines: 2,
      skipped: 0,
      errors: 0,
    });
    invariant(result);

    // Baseline'ы реально лежат в хранилище
    const homeBaseline = await storage.getBaseline({
      page: "home",
      viewport: { width: 1440, height: 900 },
    });
    expect(homeBaseline?.png).toEqual(solid(255, 0, 0));
    // Report сгенерирован, RunResult сохранён
    await access(reportPath);
    const lastRun = await storage.getLastRunResult();
    expect(lastRun?.summary).toEqual(result.summary);

    // Capture получил цели с готовым URL, resolved-viewport и слитыми Mask'ами (глобальные + per-page)
    expect(capture.targets).toHaveLength(2);
    expect(capture.targets[0]?.url).toBe("https://example.com/");
    expect(capture.targets[1]?.url).toBe("https://example.com/about");
    expect(capture.targets[0]?.mask).toEqual([".cookie-banner"]);
    expect(capture.targets[1]?.mask).toEqual([".cookie-banner", "#consultant-widget"]);
    expect(capture.targets[0]?.key.viewport).toEqual({ width: 1440, height: 900 });

    expect(toExitCode(result)).toBe(0);
  });

  it("повторный Run на неизменных снимках: unchanged, exit-код 0", async () => {
    const capture = new FakeCapture(
      fixtures(["home", solid(255, 0, 0)], ["about", solid(0, 255, 0)]),
    );
    const { runner } = await setupRunner(storageDir, reportPath, capture);
    await runner.run();

    const result = await runner.run();

    expect(result.results.map((r) => r.status)).toEqual(["unchanged", "unchanged"]);
    expect(result.results.every((r) => r.diffRatio === 0)).toBe(true);
    expect(result.summary).toEqual({
      pages: 2,
      total: 2,
      unchanged: 2,
      diffs: 0,
      newBaselines: 0,
      skipped: 0,
      errors: 0,
    });
    invariant(result);
    expect(toExitCode(result)).toBe(0);
  });

  it("изменившийся снимок: статус diff, Diff-изображение сохранено, exit-код 1", async () => {
    const first = fixtures(["home", solid(255, 0, 0)], ["about", solid(0, 255, 0)]);
    const capture = new FakeCapture(first);
    const { runner, storage } = await setupRunner(storageDir, reportPath, capture);
    await runner.run();

    first.set("home", solid(0, 0, 255)); // страница перекрасилась: красный → синий
    const result = await runner.run();

    const home = result.results.find((r) => r.key.page === "home");
    const about = result.results.find((r) => r.key.page === "about");
    expect(home?.status).toBe("diff");
    expect(home?.diffRatio).toBeGreaterThan(0);
    expect(about?.status).toBe("unchanged");
    expect(result.summary).toEqual({
      pages: 2,
      total: 2,
      unchanged: 1,
      diffs: 1,
      newBaselines: 0,
      skipped: 0,
      errors: 0,
    });
    invariant(result);

    // Diff-изображение лежит в diffs/ рядом с текущим снимком; Baseline при этом не тронут
    const diffPng = await storage.getDiff({ page: "home", viewport: { width: 1440, height: 900 } });
    expect(diffPng).not.toBeNull();
    const baseline = await storage.getBaseline({
      page: "home",
      viewport: { width: 1440, height: 900 },
    });
    expect(baseline?.png).toEqual(solid(255, 0, 0));

    expect(toExitCode(result)).toBe(1);
  });

  it("ошибка съёмки одной Page не прерывает остальные: статус error, exit-код 2", async () => {
    const capture = new FakeCapture(
      fixtures(["home", solid(255, 0, 0)], ["about", solid(0, 255, 0)]),
    );
    capture.failures.set("home", new Error("Сервер недоступен"));
    const { runner } = await setupRunner(storageDir, reportPath, capture);

    const result = await runner.run();

    const home = result.results.find((r) => r.key.page === "home");
    const about = result.results.find((r) => r.key.page === "about");
    expect(home?.status).toBe("error");
    expect(home?.error).toContain("Сервер недоступен");
    expect(about?.status).toBe("new-baseline");
    expect(result.summary).toEqual({
      pages: 2,
      total: 2,
      unchanged: 0,
      diffs: 0,
      newBaselines: 1,
      skipped: 0,
      errors: 1,
    });
    invariant(result);
    expect(toExitCode(result)).toBe(2);
  });

  it("несовпадение размеров снимка и Baseline: статус error с понятным сообщением", async () => {
    const first = fixtures(["home", solid(255, 0, 0, 20)], ["about", solid(0, 255, 0, 20)]);
    const capture = new FakeCapture(first);
    const { runner } = await setupRunner(storageDir, reportPath, capture);
    await runner.run();

    first.set("home", solid(255, 0, 0, 30)); // размер страницы изменился
    const result = await runner.run();

    const home = result.results.find((r) => r.key.page === "home");
    expect(home?.status).toBe("error");
    expect(home?.error).toMatch(/размер/i);
    expect(toExitCode(result)).toBe(2);
  });

  it("RunResult попадает в Report: HTML содержит резюме прогона", async () => {
    const capture = new FakeCapture(
      fixtures(["home", solid(255, 0, 0)], ["about", solid(0, 255, 0)]),
    );
    const { runner } = await setupRunner(storageDir, reportPath, capture);
    const result = await runner.run();

    const html = await readFile(reportPath, "utf8");
    const s = result.summary;
    expect(html).toContain(
      `Проверено ${s.pages} страниц (${s.total} снимков): без изменений ${s.unchanged}, ` +
        `изменилось ${s.diffs}, новых ${s.newBaselines}, пропущено ${s.skipped}, ошибок ${s.errors}`,
    );
  });

  it("неизвестное имя Page бросает ошибку до старта прогона", async () => {
    const capture = new FakeCapture(
      fixtures(["home", solid(255, 0, 0)], ["about", solid(0, 255, 0)]),
    );
    const { runner } = await setupRunner(storageDir, reportPath, capture);

    await expect(runner.run(["unknown"])).rejects.toThrow(/unknown/);
  });
});

describe("Runner: настройки прогона (ticket 04)", () => {
  let root: string;
  let storageDir: string;
  let reportPath: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "rescreen-runner-settings-"));
    storageDir = join(root, ".rescreen");
    reportPath = join(root, "report.html");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("порог per-page: расхождение ниже Threshold — unchanged, выше — diff", async () => {
    const shots = fixtures(["home", solid(0, 0, 0)]);
    const capture = new FakeCapture(shots);
    const { runner } = await setupRunner(storageDir, reportPath, capture, {
      baseUrl: "https://example.com",
      pages: [{ name: "home", path: "/", threshold: 0.01 }],
    });
    await runner.run();

    // 1 пиксель из 400 (0.25%) ниже порога 1%
    shots.set(
      "home",
      encodePng(
        fillRect(createPng(20, 20, { r: 0, g: 0, b: 0 }), 0, 0, 1, 1, { r: 255, g: 255, b: 255 }),
      ),
    );
    const below = await runner.run();
    expect(below.results[0]?.status).toBe("unchanged");

    shots.set("home", solid(255, 255, 255)); // 100% выше порога
    const above = await runner.run();
    expect(above.results[0]?.status).toBe("diff");
  });

  it("глобальный порог применяется, когда per-page не задан", async () => {
    const shots = fixtures(["home", solid(0, 0, 0)]);
    const capture = new FakeCapture(shots);
    const { runner } = await setupRunner(storageDir, reportPath, capture, {
      baseUrl: "https://example.com",
      threshold: 0.5,
      pages: [{ name: "home", path: "/" }],
    });
    await runner.run();

    // 4/400 = 1% < 50%
    shots.set(
      "home",
      encodePng(
        fillRect(createPng(20, 20, { r: 0, g: 0, b: 0 }), 0, 0, 2, 2, { r: 255, g: 255, b: 255 }),
      ),
    );
    const result = await runner.run();
    expect(result.results[0]?.status).toBe("unchanged");
  });

  it("viewport per-page попадает в ключ Baseline'а", async () => {
    const capture = new FakeCapture(fixtures(["home", solid(1, 2, 3)]));
    const { runner, storage } = await setupRunner(storageDir, reportPath, capture, {
      baseUrl: "https://example.com",
      pages: [{ name: "home", path: "/", viewport: { width: 800, height: 600 } }],
    });
    await runner.run();

    expect(capture.targets[0]?.key.viewport).toEqual({ width: 800, height: 600 });
    expect(
      await storage.getBaseline({ page: "home", viewport: { width: 800, height: 600 } }),
    ).not.toBeNull();
    expect(
      await storage.getBaseline({ page: "home", viewport: { width: 1440, height: 900 } }),
    ).toBeNull();
  });

  it("run [page...] обрабатывает только указанные Page, резюме считает только их", async () => {
    const capture = new FakeCapture(
      fixtures(["home", solid(255, 0, 0)], ["about", solid(0, 255, 0)]),
    );
    const { runner, storage } = await setupRunner(storageDir, reportPath, capture, {
      baseUrl: "https://example.com",
      pages: [
        { name: "home", path: "/" },
        { name: "about", path: "/about" },
      ],
    });

    const result = await runner.run(["about"]);

    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.key.page).toBe("about");
    expect(result.summary.total).toBe(1);
    expect(capture.targets.map((t) => t.key.page)).toEqual(["about"]);
    // home не снималась и Baseline под неё не создан
    expect(
      await storage.getBaseline({ page: "home", viewport: { width: 1440, height: 900 } }),
    ).toBeNull();
  });
});

describe("Runner: предупреждения и Mask'и (ticket 03)", () => {
  let root: string;
  let storageDir: string;
  let reportPath: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "rescreen-runner-warnings-"));
    storageDir = join(root, ".rescreen");
    reportPath = join(root, "report.html");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("предупреждение Capture попадает в SnapshotResult.warning и не меняет статус", async () => {
    const capture = new FakeCapture(
      fixtures(["home", solid(255, 0, 0)], ["about", solid(0, 255, 0)]),
    );
    capture.warnings.set("home", [
      "Стабильный кадр не достигнут за 5000 мс — используется последний кадр",
    ]);
    const { runner } = await setupRunner(storageDir, reportPath, capture);

    const result = await runner.run();

    const home = result.results.find((r) => r.key.page === "home");
    expect(home?.status).toBe("new-baseline");
    expect(home?.warning).toBe(
      "Стабильный кадр не достигнут за 5000 мс — используется последний кадр",
    );
    const s = result.summary;
    expect(s.total).toBe(s.unchanged + s.diffs + s.newBaselines + s.skipped + s.errors);
    expect(toExitCode(result)).toBe(0);
  });

  it('несколько предупреждений Snapshot\'а склеиваются в SnapshotResult.warning через "; "', async () => {
    const capture = new FakeCapture(
      fixtures(["home", solid(255, 0, 0)], ["about", solid(0, 255, 0)]),
    );
    capture.warnings.set("home", ["Первое предупреждение", "Второе предупреждение"]);
    const { runner } = await setupRunner(storageDir, reportPath, capture);

    const result = await runner.run();

    expect(result.results[0]?.warning).toBe("Первое предупреждение; Второе предупреждение");
  });

  it("masksApplied Snapshot'а попадает в SnapshotResult (глобальные + per-page)", async () => {
    const capture = new FakeCapture(
      fixtures(["home", solid(255, 0, 0)], ["about", solid(0, 255, 0)]),
    );
    const { runner } = await setupRunner(storageDir, reportPath, capture);

    const result = await runner.run();

    const home = result.results.find((r) => r.key.page === "home");
    const about = result.results.find((r) => r.key.page === "about");
    expect(home?.masksApplied).toEqual([".cookie-banner"]);
    expect(about?.masksApplied).toEqual([".cookie-banner", "#consultant-widget"]);
  });

  it("при ошибке съёмки masksApplied — маски, запрошенные для цели", async () => {
    const capture = new FakeCapture(
      fixtures(["home", solid(255, 0, 0)], ["about", solid(0, 255, 0)]),
    );
    capture.failures.set("home", new Error("Сервер недоступен"));
    const { runner } = await setupRunner(storageDir, reportPath, capture);

    const result = await runner.run();

    const home = result.results.find((r) => r.key.page === "home");
    expect(home?.status).toBe("error");
    expect(home?.masksApplied).toEqual([".cookie-banner"]);
  });
});

describe("Runner: Snapshot'ы элементов (ticket 05)", () => {
  let root: string;
  let storageDir: string;
  let reportPath: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "rescreen-runner-elements-"));
    storageDir = join(root, ".rescreen");
    reportPath = join(root, "report.html");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const elementConfig: Parameters<typeof resolveConfig>[0] = {
    baseUrl: "https://example.com",
    mask: [".cookie-banner"],
    pages: [
      {
        name: "home",
        path: "/",
        mask: ["#consultant-widget"],
        elements: ["header", ".main-nav"],
      },
    ],
  };

  const elementFixtures = () =>
    fixtures(
      ["home", solid(255, 0, 0)],
      ["header", solid(0, 255, 0)],
      [".main-nav", solid(0, 0, 255)],
    );

  const viewport = { width: 1440, height: 900 };

  it("elements из конфига снимаются отдельными Snapshot'ами со своими Baseline'ами", async () => {
    const capture = new FakeCapture(elementFixtures());
    const { runner, storage } = await setupRunner(storageDir, reportPath, capture, elementConfig);

    const result = await runner.run();

    // Три цели: страница + оба элемента; URL и слитые Mask'и у элементов те же, что у страницы
    expect(capture.targets.map((t) => t.key)).toEqual([
      { page: "home", viewport },
      { page: "home", viewport, element: "header" },
      { page: "home", viewport, element: ".main-nav" },
    ]);
    for (const target of capture.targets) {
      expect(target.url).toBe("https://example.com/");
      expect(target.mask).toEqual([".cookie-banner", "#consultant-widget"]);
    }

    expect(result.results.map((r) => r.status)).toEqual([
      "new-baseline",
      "new-baseline",
      "new-baseline",
    ]);
    // Резюме различает Page и Snapshot'ы: страница одна, снимков три
    expect(result.summary).toEqual({
      pages: 1,
      total: 3,
      unchanged: 0,
      diffs: 0,
      newBaselines: 3,
      skipped: 0,
      errors: 0,
    });

    // У каждого элемента свой Baseline под ключом page + viewport + селектор
    expect((await storage.getBaseline({ page: "home", viewport }))?.png).toEqual(solid(255, 0, 0));
    expect((await storage.getBaseline({ page: "home", viewport, element: "header" }))?.png).toEqual(
      solid(0, 255, 0),
    );
    expect(
      (await storage.getBaseline({ page: "home", viewport, element: ".main-nav" }))?.png,
    ).toEqual(solid(0, 0, 255));
    expect(toExitCode(result)).toBe(0);
  });

  it("полный цикл элемента идентичен страничному: unchanged → diff, Diff-изображение под своим ключом", async () => {
    const shots = elementFixtures();
    const capture = new FakeCapture(shots);
    const { runner, storage } = await setupRunner(storageDir, reportPath, capture, elementConfig);
    await runner.run();

    const again = await runner.run();
    expect(again.results.map((r) => r.status)).toEqual(["unchanged", "unchanged", "unchanged"]);

    // Меняется только header: Diff только у его Snapshot'а
    shots.set("header", solid(1, 2, 3));
    const result = await runner.run();

    const [page, header, nav] = result.results;
    expect(page?.status).toBe("unchanged");
    expect(header?.status).toBe("diff");
    expect(header?.diffRatio).toBeGreaterThan(0);
    expect(nav?.status).toBe("unchanged");
    expect(result.summary).toEqual({
      pages: 1,
      total: 3,
      unchanged: 2,
      diffs: 1,
      newBaselines: 0,
      skipped: 0,
      errors: 0,
    });

    expect(await storage.getDiff({ page: "home", viewport, element: "header" })).not.toBeNull();
    expect(await storage.getDiff({ page: "home", viewport })).toBeNull();
    // Baseline страницы не тронут
    expect((await storage.getBaseline({ page: "home", viewport }))?.png).toEqual(solid(255, 0, 0));
    expect(toExitCode(result)).toBe(1);
  });

  it("порог per-page действует и на элементные Snapshot'ы", async () => {
    const shots = fixtures(["home", solid(0, 0, 0)], ["header", solid(0, 0, 0)]);
    const capture = new FakeCapture(shots);
    const { runner } = await setupRunner(storageDir, reportPath, capture, {
      baseUrl: "https://example.com",
      pages: [{ name: "home", path: "/", threshold: 0.01, elements: ["header"] }],
    });
    await runner.run();

    // 1 пиксель из 400 (0.25%) ниже порога 1% — unchanged даже у элемента
    shots.set(
      "header",
      encodePng(
        fillRect(createPng(20, 20, { r: 0, g: 0, b: 0 }), 0, 0, 1, 1, { r: 255, g: 255, b: 255 }),
      ),
    );
    const below = await runner.run();
    expect(below.results.find((r) => r.key.element === "header")?.status).toBe("unchanged");

    shots.set("header", solid(255, 255, 255)); // 100% выше порога
    const above = await runner.run();
    expect(above.results.find((r) => r.key.element === "header")?.status).toBe("diff");
  });

  it("глобальный порог действует и на элементные Snapshot'ы", async () => {
    const shots = fixtures(["home", solid(0, 0, 0)], ["header", solid(0, 0, 0)]);
    const capture = new FakeCapture(shots);
    const { runner } = await setupRunner(storageDir, reportPath, capture, {
      baseUrl: "https://example.com",
      threshold: 0.5,
      pages: [{ name: "home", path: "/", elements: ["header"] }],
    });
    await runner.run();

    // 4/400 = 1% < 50% — unchanged и у страницы, и у элемента
    shots.set(
      "header",
      encodePng(
        fillRect(createPng(20, 20, { r: 0, g: 0, b: 0 }), 0, 0, 2, 2, { r: 255, g: 255, b: 255 }),
      ),
    );
    const result = await runner.run();
    expect(result.results.find((r) => r.key.element === "header")?.status).toBe("unchanged");
  });

  it("ненайденный селектор — статус skipped с предупреждением: Run не прерывается, exit-код не 2", async () => {
    const capture = new FakeCapture(
      fixtures(["home", solid(255, 0, 0)], ["header", solid(0, 255, 0)]),
    );
    capture.failures.set(".main-nav", new ElementNotFoundError(".main-nav", "home"));
    const { runner } = await setupRunner(storageDir, reportPath, capture, elementConfig);

    const result = await runner.run();

    const [page, header, nav] = result.results;
    expect(page?.status).toBe("new-baseline");
    expect(header?.status).toBe("new-baseline");
    expect(nav?.status).toBe("skipped");
    expect(nav?.warning).toBe('Element ".main-nav" не найден на странице "home"');
    expect(nav?.error).toBeUndefined();
    expect(nav?.masksApplied).toEqual([".cookie-banner", "#consultant-widget"]);

    expect(result.summary).toEqual({
      pages: 1,
      total: 3,
      unchanged: 0,
      diffs: 0,
      newBaselines: 2,
      skipped: 1,
      errors: 0,
    });
    expect(toExitCode(result)).toBe(0);
  });

  it("skipped Snapshot не создаёт Baseline и не кладётся в current/", async () => {
    const capture = new FakeCapture(fixtures(["home", solid(255, 0, 0)]));
    capture.failures.set("header", new ElementNotFoundError("header", "home"));
    const { runner, storage } = await setupRunner(storageDir, reportPath, capture, {
      baseUrl: "https://example.com",
      pages: [{ name: "home", path: "/", elements: ["header"] }],
    });

    const result = await runner.run();

    expect(result.results.map((r) => r.status)).toEqual(["new-baseline", "skipped"]);
    expect(await storage.getBaseline({ page: "home", viewport, element: "header" })).toBeNull();
    expect(await storage.getCurrent({ page: "home", viewport, element: "header" })).toBeNull();
  });

  it("предупреждение о ненайденном элементе видно в Report'е", async () => {
    const capture = new FakeCapture(fixtures(["home", solid(255, 0, 0)]));
    capture.failures.set("header", new ElementNotFoundError("header", "home"));
    const { runner } = await setupRunner(storageDir, reportPath, capture, {
      baseUrl: "https://example.com",
      pages: [{ name: "home", path: "/", elements: ["header"] }],
    });

    await runner.run();

    const html = await readFile(reportPath, "utf8");
    expect(html).toContain("Element &quot;header&quot; не найден на странице &quot;home&quot;");
    expect(html).toContain("пропущено 1");
  });
});
