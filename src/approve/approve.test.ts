import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { createApprover } from "./approve.js";
import { resolveConfig } from "../config/loader.js";
import { createPixelmatchDiffEngine } from "../diff/pixelmatch.js";
import { createRunner } from "../runner/runner.js";
import { createFileStorage, type FileBaselineStorage } from "../storage/file.js";
import { createPng, encodePng, makeSnapshot } from "../test-utils/png.js";
import type { Capture, CaptureTarget } from "../capture/types.js";
import type { Reporter } from "../report/types.js";
import type { SnapshotResult } from "../runner/types.js";
import type { Snapshot, SnapshotKey } from "../snapshot/types.js";

const viewport = { width: 1440, height: 900 };

const key = (overrides: Partial<SnapshotKey> = {}): SnapshotKey => ({
  page: "home",
  viewport,
  ...overrides,
});

const pngA = () => encodePng(createPng(4, 4, { r: 255, g: 0, b: 0 }));
const pngB = () => encodePng(createPng(4, 4, { r: 0, g: 0, b: 255 }));

const summaryOf = (results: readonly SnapshotResult[]) => {
  const count = (status: SnapshotResult["status"]) =>
    results.filter((r) => r.status === status).length;
  return {
    pages: new Set(results.map((r) => r.key.page)).size,
    total: results.length,
    unchanged: count("unchanged"),
    diffs: count("diff"),
    newBaselines: count("new-baseline"),
    skipped: count("skipped"),
    errors: count("error"),
  };
};

/** Состояние «после Run'а с Diff'ом»: Baseline старый, текущий Snapshot новый, статус diff. */
async function seedDiff(
  storage: FileBaselineStorage,
  k: SnapshotKey,
  baselinePng: Uint8Array = pngA(),
  currentPng: Uint8Array = pngB(),
): Promise<SnapshotResult> {
  await storage.saveBaseline(makeSnapshot(k, baselinePng));
  await storage.saveCurrent(makeSnapshot(k, currentPng));
  return { key: k, status: "diff", diffRatio: 1, masksApplied: [] };
}

async function seedRun(
  storage: FileBaselineStorage,
  results: readonly SnapshotResult[],
): Promise<void> {
  await storage.saveRunResult({
    startedAt: new Date("2026-10-12T10:00:00.000Z"),
    results,
    summary: summaryOf(results),
  });
}

async function readAudit(root: string): Promise<Array<Record<string, unknown>>> {
  let raw: string;
  try {
    raw = await readFile(join(root, "audit.jsonl"), "utf8");
  } catch {
    return [];
  }
  return raw
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe("Approver (workflow команды approve)", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "rescreen-approve-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("до первого Run'а: нечего аппрувить — пустой результат, без ошибки", async () => {
    const storage = createFileStorage(root);
    const approver = createApprover({ storage });

    const result = await approver.approve();

    expect(result.approved).toEqual([]);
    expect(await readAudit(root)).toEqual([]);
  });

  it("последний Run без Diff'ов: нечего аппрувить", async () => {
    const storage = createFileStorage(root);
    const k = key();
    const png = pngA();
    await storage.saveBaseline(makeSnapshot(k, png));
    await storage.saveCurrent(makeSnapshot(k, png));
    await seedRun(storage, [{ key: k, status: "unchanged", diffRatio: 0, masksApplied: [] }]);
    const approver = createApprover({ storage });

    const result = await approver.approve();

    expect(result.approved).toEqual([]);
    expect(await readAudit(root)).toEqual([]);
  });

  it("approve без аргументов аппрувит все Diff'ы последнего Run'а: Snapshot'ы стали Baseline'ами, аудит пополнился", async () => {
    const storage = createFileStorage(root);
    const home = key();
    const about = key({ page: "about" });
    const results = [await seedDiff(storage, home), await seedDiff(storage, about)];
    await seedRun(storage, results);
    const approver = createApprover({ storage });

    const result = await approver.approve();

    expect(result.approved.map((s) => s.key.page)).toEqual(["home", "about"]);
    // Каждый текущий Snapshot стал Baseline'ом
    expect((await storage.getBaseline(home))?.png).toEqual(pngB());
    expect((await storage.getBaseline(about))?.png).toEqual(pngB());
    // Ровно одна запись аудита на Snapshot
    const audit = await readAudit(root);
    expect(audit).toHaveLength(2);
    expect(audit.map((e) => e.page)).toEqual(["home", "about"]);
  });

  it("approve <page...> аппрувит только указанные Page; остальные остаются неаппрувнутыми", async () => {
    const storage = createFileStorage(root);
    const home = key();
    const about = key({ page: "about" });
    const results = [await seedDiff(storage, home), await seedDiff(storage, about)];
    await seedRun(storage, results);
    const approver = createApprover({ storage });

    const result = await approver.approve(["home"]);

    expect(result.approved.map((s) => s.key.page)).toEqual(["home"]);
    // home: текущий Snapshot стал Baseline'ом
    expect((await storage.getBaseline(home))?.png).toEqual(pngB());
    // about осталась «красной»: Baseline старый, текущий Snapshot отличается
    expect((await storage.getBaseline(about))?.png).toEqual(pngA());
    expect((await storage.getCurrent(about))?.png).toEqual(pngB());
    const audit = await readAudit(root);
    expect(audit).toHaveLength(1);
    expect(audit[0]?.page).toBe("home");
  });

  it("идемпотентность: повторный approve без нового Run'а — нечего аппрувить, аудит не растёт", async () => {
    const storage = createFileStorage(root);
    const home = key();
    await seedRun(storage, [await seedDiff(storage, home)]);
    const approver = createApprover({ storage });

    await approver.approve();
    const second = await approver.approve();

    expect(second.approved).toEqual([]);
    expect(await readAudit(root)).toHaveLength(1);
  });

  it("частичный approve, затем approve оставшейся Page: обе записи в аудите по одной", async () => {
    const storage = createFileStorage(root);
    const home = key();
    const about = key({ page: "about" });
    await seedRun(storage, [await seedDiff(storage, home), await seedDiff(storage, about)]);
    const approver = createApprover({ storage });

    await approver.approve(["home"]);
    const rest = await approver.approve(["about"]);

    expect(rest.approved.map((s) => s.key.page)).toEqual(["about"]);
    expect(await readAudit(root)).toHaveLength(2);
  });

  it("approve с именем Page, которого нет в последнем Run'е, бросает ошибку", async () => {
    const storage = createFileStorage(root);
    await seedRun(storage, [await seedDiff(storage, key())]);
    const approver = createApprover({ storage });

    await expect(approver.approve(["unknown"])).rejects.toThrow(/unknown/);
  });

  it("approve <page...> до первого Run'а: имена проверить негде — ошибка, а не «нечего аппрувить»", async () => {
    const storage = createFileStorage(root);
    const approver = createApprover({ storage });

    await expect(approver.approve(["home"])).rejects.toThrow(/home/);
    // без аргументов — по-прежнему «нечего аппрувить», без ошибки
    expect((await approver.approve()).approved).toEqual([]);
  });

  it("элементные Snapshot'ы аппрувятся вместе со своей Page", async () => {
    const storage = createFileStorage(root);
    const page = key();
    const header = key({ element: "header" });
    await seedRun(storage, [await seedDiff(storage, page), await seedDiff(storage, header)]);
    const approver = createApprover({ storage });

    const result = await approver.approve(["home"]);

    expect(result.approved.map((s) => s.key)).toEqual([page, header]);
    expect((await storage.getBaseline(header))?.png).toEqual(pngB());
    const audit = await readAudit(root);
    expect(audit).toHaveLength(2);
    expect(audit[1]?.element).toBe("header");
  });
});

describe("Approve + Run: частичный Approve и пересъёмка (spec, story 24)", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "rescreen-approve-run-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  /** Фейковый Capture (главный шов): отдаёт PNG-фикстуры по имени Page. */
  class FakeCapture implements Capture {
    readonly targets: CaptureTarget[] = [];
    constructor(private fixtures: Map<string, Uint8Array>) {}
    async capture(target: CaptureTarget): Promise<Snapshot> {
      this.targets.push(target);
      const png = this.fixtures.get(target.key.page);
      if (!png) throw new Error(`Нет фикстуры для "${target.key.page}"`);
      return { key: target.key, png, capturedAt: new Date(), masksApplied: [], warnings: [] };
    }
    async dispose(): Promise<void> {}
  }

  const noopReporter: Reporter = { render: async () => "" };

  it("после частичного Approve `run <page...>` переснимает только неаппрувнутое, подтверждённое не трогается", async () => {
    const fixtures = new Map([
      ["home", pngA()],
      ["about", pngA()],
    ]);
    const capture = new FakeCapture(fixtures);
    const storage = createFileStorage(join(root, ".rescreen"));
    const runner = createRunner({
      config: resolveConfig({
        baseUrl: "https://example.com",
        pages: [
          { name: "home", path: "/" },
          { name: "about", path: "/about" },
        ],
      }),
      capture,
      diffEngine: createPixelmatchDiffEngine(),
      storage,
      reporter: noopReporter,
    });
    const approver = createApprover({ storage });

    // Первый Run — Baseline'ы; затем обе страницы «перекрасились» — обе с Diff'ами
    await runner.run();
    fixtures.set("home", pngB());
    fixtures.set("about", pngB());
    const withDiffs = await runner.run();
    expect(withDiffs.summary.diffs).toBe(2);

    // Аппрувим только home — ожидаемое изменение
    await approver.approve(["home"]);

    // Фикс about: страница вернулась к исходному виду; переснимаем только её
    fixtures.set("about", pngA());
    capture.targets.length = 0;
    const rerun = await runner.run(["about"]);

    // Снималась только about; подтверждённая home не трогается
    expect(capture.targets.map((t) => t.key.page)).toEqual(["about"]);
    expect(rerun.results).toHaveLength(1);
    expect(rerun.results[0]?.key.page).toBe("about");
    expect(rerun.results[0]?.status).toBe("unchanged");
    // Подтверждённый Baseline home не изменился
    expect((await storage.getBaseline(key()))?.png).toEqual(pngB());
    // Пересъёмка не порождала новых записей аудита
    expect(await readAudit(join(root, ".rescreen"))).toHaveLength(1);
  });
});
