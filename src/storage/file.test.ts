import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import fc from "fast-check";

import { createFileStorage } from "./file.js";
import { createPng, encodePng, makeSnapshot } from "../test-utils/png.js";
import type { RunResult } from "../runner/types.js";
import type { SnapshotKey } from "../snapshot/types.js";

const key = (overrides: Partial<SnapshotKey> = {}): SnapshotKey => ({
  page: "home",
  viewport: { width: 1440, height: 900 },
  ...overrides,
});

describe("BaselineStorage (файловая реализация)", () => {
  let root: string;
  let cleanup: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "rescreen-storage-"));
    cleanup = root;
  });

  afterEach(async () => {
    await rm(cleanup, { recursive: true, force: true });
  });

  it("round-trip: saveBaseline → getBaseline возвращает тот же png, ключ и метаданные", async () => {
    const storage = createFileStorage(root);
    const snapshot = makeSnapshot(key(), encodePng(createPng(4, 3, { r: 1, g: 2, b: 3 })), [
      ".cookie",
      "#chat",
    ]);

    await storage.saveBaseline(snapshot);
    const loaded = await storage.getBaseline(key());

    expect(loaded).not.toBeNull();
    expect(loaded?.png).toEqual(snapshot.png);
    expect(loaded?.key).toEqual(snapshot.key);
    expect(loaded?.capturedAt).toEqual(snapshot.capturedAt);
    expect(loaded?.masksApplied).toEqual([".cookie", "#chat"]);
  });

  it("round-trip: селекторы со слешем, пробелами и юникодом кодируются в имя файла без потерь", async () => {
    const storage = createFileStorage(root);
    const weird = key({ element: "nav .menu > li:nth-child(2) / главная" });
    const snapshot = makeSnapshot(weird, encodePng(createPng(2, 2)));

    await storage.saveBaseline(snapshot);
    const loaded = await storage.getBaseline(weird);

    expect(loaded?.key.element).toBe("nav .menu > li:nth-child(2) / главная");
    expect(loaded?.png).toEqual(snapshot.png);
  });

  it("saveCurrent не трогает Baseline", async () => {
    const storage = createFileStorage(root);
    const k = key();
    const baseline = makeSnapshot(k, encodePng(createPng(2, 2, { r: 0, g: 0, b: 0 })));
    const current = makeSnapshot(k, encodePng(createPng(2, 2, { r: 255, g: 255, b: 255 })));

    await storage.saveBaseline(baseline);
    await storage.saveCurrent(current);

    expect((await storage.getBaseline(k))?.png).toEqual(baseline.png);
  });

  it("approve: текущий Snapshot становится Baseline'ом, в аудит-логе ровно одна запись", async () => {
    const storage = createFileStorage(root);
    const k = key({ element: ".hero" });
    const current = makeSnapshot(k, encodePng(createPng(2, 2, { r: 9, g: 9, b: 9 })));
    await storage.saveCurrent(current);

    const approved = await storage.approve(k);

    expect(approved.png).toEqual(current.png);
    expect((await storage.getBaseline(k))?.png).toEqual(current.png);

    const audit = await readFile(join(root, "audit.jsonl"), "utf8");
    const lines = audit.trim().split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0] as string) as Record<string, unknown>;
    expect(entry.page).toBe("home");
    expect(entry.element).toBe(".hero");
    expect(entry.viewport).toEqual({ width: 1440, height: 900 });
    expect(typeof entry.at).toBe("string");
  });

  it("approve идемпотентен: повторный вызов без нового Run не меняет Baseline и не пишет в аудит", async () => {
    const storage = createFileStorage(root);
    const k = key();
    await storage.saveCurrent(makeSnapshot(k, encodePng(createPng(2, 2))));

    await storage.approve(k);
    await storage.approve(k);

    const audit = await readFile(join(root, "audit.jsonl"), "utf8");
    expect(audit.trim().split("\n").filter(Boolean)).toHaveLength(1);
  });

  it("approve без текущего Snapshot бросает ошибку", async () => {
    const storage = createFileStorage(root);

    await expect(storage.approve(key())).rejects.toThrow(/нет текущего снимка/i);
  });

  it("getLastRunResult: null пока Run'ов не было; round-trip после saveRunResult", async () => {
    const storage = createFileStorage(root);
    expect(await storage.getLastRunResult()).toBeNull();

    const result: RunResult = {
      startedAt: new Date("2026-10-11T10:00:00.000Z"),
      results: [
        { key: key(), status: "unchanged", diffRatio: 0, masksApplied: [".cookie"] },
        { key: key({ page: "news" }), status: "diff", diffRatio: 0.42, masksApplied: [] },
      ],
      summary: { total: 2, unchanged: 1, diffs: 1, newBaselines: 0, errors: 0 },
    };
    await storage.saveRunResult(result);

    const loaded = await storage.getLastRunResult();
    expect(loaded?.startedAt).toEqual(result.startedAt);
    expect(loaded?.results).toEqual(result.results);
    expect(loaded?.summary).toEqual(result.summary);
  });

  it("round-trip: warnings сохраняются в sidecar вместе с masksApplied", async () => {
    const storage = createFileStorage(root);
    const snapshot = makeSnapshot(
      key(),
      encodePng(createPng(2, 2)),
      [".cookie"],
      new Date("2026-10-11T12:00:00.000Z"),
      ["Стабильный кадр не достигнут за 5000 мс — используется последний кадр"],
    );

    await storage.saveCurrent(snapshot);
    const loaded = await storage.getCurrent(key());

    expect(loaded?.warnings).toEqual([
      "Стабильный кадр не достигнут за 5000 мс — используется последний кадр",
    ]);
    expect(loaded?.masksApplied).toEqual([".cookie"]);
  });

  it("sidecar без warnings (формат до ticket 03) читается с warnings = []", async () => {
    const storage = createFileStorage(root);
    await mkdir(join(root, "current"), { recursive: true });
    await writeFile(join(root, "current", "home__1440x900.png"), encodePng(createPng(1, 1)));
    await writeFile(
      join(root, "current", "home__1440x900.json"),
      JSON.stringify({ capturedAt: "2026-10-10T00:00:00.000Z", masksApplied: [".old"] }),
    );

    const loaded = await storage.getCurrent(key());

    expect(loaded).not.toBeNull();
    expect(loaded?.warnings).toEqual([]);
    expect(loaded?.masksApplied).toEqual([".old"]);
  });

  it("getBaseline по неизвестному ключу возвращает null", async () => {
    const storage = createFileStorage(root);
    expect(await storage.getBaseline(key({ page: "unknown" }))).toBeNull();
  });

  it("getCurrent: null до первого Run, round-trip после saveCurrent", async () => {
    const storage = createFileStorage(root);
    const k = key();
    expect(await storage.getCurrent(k)).toBeNull();

    const current = makeSnapshot(k, encodePng(createPng(3, 3, { r: 7, g: 8, b: 9 })), [".banner"]);
    await storage.saveCurrent(current);

    const loaded = await storage.getCurrent(k);
    expect(loaded?.png).toEqual(current.png);
    expect(loaded?.masksApplied).toEqual([".banner"]);
  });

  it("saveDiff → getDiff round-trip; по неизвестному ключу null; Baseline и current не трогаются", async () => {
    const storage = createFileStorage(root);
    const k = key();
    expect(await storage.getDiff(k)).toBeNull();

    const baseline = makeSnapshot(k, encodePng(createPng(2, 2, { r: 0, g: 0, b: 0 })));
    const current = makeSnapshot(k, encodePng(createPng(2, 2, { r: 255, g: 255, b: 255 })));
    const diffPng = encodePng(createPng(2, 2, { r: 255, g: 0, b: 255 }));
    await storage.saveBaseline(baseline);
    await storage.saveCurrent(current);

    await storage.saveDiff(k, diffPng);

    expect(await storage.getDiff(k)).toEqual(diffPng);
    expect((await storage.getBaseline(k))?.png).toEqual(baseline.png);
    expect((await storage.getCurrent(k))?.png).toEqual(current.png);
  });

  it("несуществующий файл снимка возвращает null, а не падает", async () => {
    const storage = createFileStorage(root);
    // png-файл есть, а метаданные отсутствуют — хранилище не должно падать
    await mkdir(join(root, "baselines"), { recursive: true });
    await writeFile(join(root, "baselines", "home__1440x900.png"), encodePng(createPng(1, 1)));
    const loaded = await storage.getBaseline(key());
    expect(loaded).not.toBeNull();
    expect(loaded?.masksApplied).toEqual([]);
  });

  it("property: round-trip для любых допустимых ключей (fast-check)", async () => {
    const storage = createFileStorage(root);
    // page — slug (см. предусловие SnapshotKey); element — произвольная строка
    const slug = fc.string({
      unit: fc.constantFrom(
        ..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_".split(""),
      ),
      minLength: 1,
      maxLength: 24,
    });
    const arbitraryKey = fc.record({
      page: slug,
      viewport: fc.record({
        width: fc.integer({ min: 1, max: 10000 }),
        height: fc.integer({ min: 1, max: 10000 }),
      }),
      element: fc.option(fc.string({ unit: "grapheme", maxLength: 60 }), { nil: undefined }),
    });

    await fc.assert(
      fc.asyncProperty(arbitraryKey, async (k) => {
        const snapshot = makeSnapshot(k, encodePng(createPng(1, 1)));
        await storage.saveBaseline(snapshot);
        const loaded = await storage.getBaseline(k);
        expect(loaded?.png).toEqual(snapshot.png);
        expect(loaded?.key).toEqual(k);
      }),
      { numRuns: 30 },
    );
  });
});
