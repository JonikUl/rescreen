import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { createRunner } from "./runner.js";
import { toExitCode } from "./exit-code.js";
import { resolveConfig } from "../config/loader.js";
import { createPixelmatchDiffEngine } from "../diff/pixelmatch.js";
import { createFileStorage } from "../storage/file.js";
import { createHtmlReporter } from "../report/html.js";
import { createPng, encodePng } from "../test-utils/png.js";
import type { Capture, CaptureTarget } from "../capture/types.js";
import type { Snapshot } from "../snapshot/types.js";
import type { RunResult } from "./types.js";

/** Фейковый Capture: отдаёт PNG-фикстуры, умеет «падать» для заданных Page. */
class FakeCapture implements Capture {
  readonly targets: CaptureTarget[] = [];
  failures = new Map<string, Error>();

  constructor(private fixtures: Map<string, Uint8Array>) {}

  async capture(target: CaptureTarget): Promise<Snapshot> {
    this.targets.push(target);
    const failure = this.failures.get(target.key.page);
    if (failure) throw failure;
    const png = this.fixtures.get(target.key.page);
    if (!png) throw new Error(`Нет фикстуры для Page "${target.key.page}"`);
    return { key: target.key, png, capturedAt: new Date(), masksApplied: target.mask };
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

  async function makeRunner(capture: FakeCapture) {
    const storage = createFileStorage(storageDir);
    const reporter = createHtmlReporter(reportPath, { storage });
    const runner = createRunner({
      config,
      capture,
      diffEngine: createPixelmatchDiffEngine(),
      storage,
      reporter,
    });
    return { runner, storage };
  }

  const invariant = (result: RunResult) => {
    const s = result.summary;
    expect(s.total).toBe(s.unchanged + s.diffs + s.newBaselines + s.errors);
    expect(s.total).toBe(result.results.length);
  };

  it("первый Run создаёт Baseline'ы автоматически и возвращает сводку", async () => {
    const capture = new FakeCapture(
      fixtures(["home", solid(255, 0, 0)], ["about", solid(0, 255, 0)]),
    );
    const { runner, storage } = await makeRunner(capture);

    const result = await runner.run();

    expect(result.results.map((r) => r.status)).toEqual(["new-baseline", "new-baseline"]);
    expect(result.summary).toEqual({
      total: 2,
      unchanged: 0,
      diffs: 0,
      newBaselines: 2,
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
    const { runner } = await makeRunner(capture);
    await runner.run();

    const result = await runner.run();

    expect(result.results.map((r) => r.status)).toEqual(["unchanged", "unchanged"]);
    expect(result.results.every((r) => r.diffRatio === 0)).toBe(true);
    expect(result.summary).toEqual({
      total: 2,
      unchanged: 2,
      diffs: 0,
      newBaselines: 0,
      errors: 0,
    });
    invariant(result);
    expect(toExitCode(result)).toBe(0);
  });

  it("изменившийся снимок: статус diff, Diff-изображение сохранено, exit-код 1", async () => {
    const first = fixtures(["home", solid(255, 0, 0)], ["about", solid(0, 255, 0)]);
    const capture = new FakeCapture(first);
    const { runner, storage } = await makeRunner(capture);
    await runner.run();

    first.set("home", solid(0, 0, 255)); // страница перекрасилась: красный → синий
    const result = await runner.run();

    const home = result.results.find((r) => r.key.page === "home");
    const about = result.results.find((r) => r.key.page === "about");
    expect(home?.status).toBe("diff");
    expect(home?.diffRatio).toBeGreaterThan(0);
    expect(about?.status).toBe("unchanged");
    expect(result.summary).toEqual({
      total: 2,
      unchanged: 1,
      diffs: 1,
      newBaselines: 0,
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
    const { runner } = await makeRunner(capture);

    const result = await runner.run();

    const home = result.results.find((r) => r.key.page === "home");
    const about = result.results.find((r) => r.key.page === "about");
    expect(home?.status).toBe("error");
    expect(home?.error).toContain("Сервер недоступен");
    expect(about?.status).toBe("new-baseline");
    expect(result.summary).toEqual({
      total: 2,
      unchanged: 0,
      diffs: 0,
      newBaselines: 1,
      errors: 1,
    });
    invariant(result);
    expect(toExitCode(result)).toBe(2);
  });

  it("несовпадение размеров снимка и Baseline: статус error с понятным сообщением", async () => {
    const first = fixtures(["home", solid(255, 0, 0, 20)], ["about", solid(0, 255, 0, 20)]);
    const capture = new FakeCapture(first);
    const { runner } = await makeRunner(capture);
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
    const { runner } = await makeRunner(capture);
    const result = await runner.run();

    const html = await readFile(reportPath, "utf8");
    expect(html).toContain(
      `Проверено ${result.summary.total} страниц: без изменений ${result.summary.unchanged}, ` +
        `изменилось ${result.summary.diffs}, новых ${result.summary.newBaselines}, ошибок ${result.summary.errors}`,
    );
  });

  it("неизвестное имя Page бросает ошибку до старта прогона", async () => {
    const capture = new FakeCapture(
      fixtures(["home", solid(255, 0, 0)], ["about", solid(0, 255, 0)]),
    );
    const { runner } = await makeRunner(capture);

    await expect(runner.run(["unknown"])).rejects.toThrow(/unknown/);
  });
});
