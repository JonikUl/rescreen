import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { pruneOrphans } from "./prune.js";
import type { RescreenConfig } from "../config/types.js";
import type { SnapshotKey } from "../snapshot/types.js";
import { createFileStorage } from "../storage/file.js";
import { createPng, encodePng, makeSnapshot } from "../test-utils/png.js";

const config: RescreenConfig = {
  baseUrl: "https://example.com",
  pages: [
    { name: "home", path: "/", elements: ["header"] },
    { name: "news", path: "/news", viewport: { width: 800, height: 600 } },
  ],
};

const currentKeys: readonly SnapshotKey[] = [
  { page: "home", viewport: { width: 1440, height: 900 } },
  { page: "home", viewport: { width: 1440, height: 900 }, element: "header" },
  { page: "news", viewport: { width: 800, height: 600 } },
];

const staleKeys: readonly SnapshotKey[] = [
  { page: "home", viewport: { width: 1440, height: 900 }, element: ".removed" },
  { page: "home", viewport: { width: 390, height: 844 } },
  { page: "removed", viewport: { width: 1440, height: 900 } },
];

describe("Prune (очистка SnapshotKey вне конфига)", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "rescreen-prune-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("dry-run находит удалённые Page и Element'ы и старые viewport'ы, ничего не удаляя", async () => {
    const storage = createFileStorage(root);
    const png = encodePng(createPng(1, 1));
    for (const key of [...currentKeys, ...staleKeys]) {
      await storage.saveBaseline(makeSnapshot(key, png));
    }

    const preview = await pruneOrphans({ config, storage, dryRun: true });

    expect(preview).toHaveLength(staleKeys.length);
    expect(preview).toEqual(expect.arrayContaining([...staleKeys]));
    for (const key of [...currentKeys, ...staleKeys]) {
      expect(await storage.getBaseline(key)).not.toBeNull();
    }
  });

  it("без dry-run удаляет только сирот и возвращает их ключи", async () => {
    const storage = createFileStorage(root);
    const png = encodePng(createPng(1, 1));
    for (const key of [...currentKeys, ...staleKeys]) {
      await storage.saveBaseline(makeSnapshot(key, png));
    }

    const pruned = await pruneOrphans({ config, storage });

    expect(pruned).toHaveLength(staleKeys.length);
    expect(pruned).toEqual(expect.arrayContaining([...staleKeys]));
    for (const key of staleKeys) {
      expect(await storage.getBaseline(key)).toBeNull();
    }
    for (const key of currentKeys) {
      expect(await storage.getBaseline(key)).not.toBeNull();
    }
  });
});
