import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { getStatusBoard } from "./status.js";
import type { RescreenConfig } from "../config/types.js";
import { createFileStorage } from "../storage/file.js";

const config: RescreenConfig = {
  baseUrl: "https://example.com",
  pages: [
    { name: "home", path: "/", elements: ["header"] },
    { name: "news", path: "/news", viewport: { width: 800, height: 600 } },
  ],
};

describe("Status (доска актуального состояния)", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "rescreen-status-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("возвращает configured ключи в порядке Page и Element; без state.json — нет данных", async () => {
    const storage = createFileStorage(root);

    const board = await getStatusBoard({ config, storage });

    expect(board).toEqual([
      {
        key: { page: "home", viewport: { width: 1440, height: 900 } },
        state: null,
      },
      {
        key: { page: "home", viewport: { width: 1440, height: 900 }, element: "header" },
        state: null,
      },
      {
        key: { page: "news", viewport: { width: 800, height: 600 } },
        state: null,
      },
    ]);
  });

  it("присоединяет последние состояния и скрывает ключи, которых нет в текущем конфиге", async () => {
    const storage = createFileStorage(root);
    const capturedAt = new Date("2026-10-11T10:00:02.000Z");
    await storage.saveRunResult({
      startedAt: new Date("2026-10-11T10:00:00.000Z"),
      results: [
        {
          key: { page: "home", viewport: { width: 1440, height: 900 } },
          status: "diff",
          attemptedAt: new Date("2026-10-11T10:00:01.000Z"),
          capturedAt,
          diffRatio: 0.1,
          masksApplied: [],
        },
        {
          key: { page: "home", viewport: { width: 1440, height: 900 }, element: "header" },
          status: "unchanged",
          attemptedAt: new Date("2026-10-11T10:00:03.000Z"),
          capturedAt: new Date("2026-10-11T10:00:04.000Z"),
          diffRatio: 0,
          masksApplied: [],
        },
        {
          key: { page: "removed", viewport: { width: 1440, height: 900 } },
          status: "error",
          attemptedAt: new Date("2026-10-11T10:00:05.000Z"),
          masksApplied: [],
          error: "Старая Page",
        },
      ],
      summary: {
        pages: 2,
        total: 3,
        unchanged: 1,
        diffs: 1,
        newBaselines: 0,
        skipped: 0,
        errors: 1,
      },
    });

    const board = await getStatusBoard({ config, storage });

    expect(board.map((entry) => entry.state?.status ?? null)).toEqual(["diff", "unchanged", null]);
    expect(board.map((entry) => entry.key.page)).toEqual(["home", "home", "news"]);
    expect(board[0]?.state?.capturedAt).toEqual(capturedAt);
  });
});
