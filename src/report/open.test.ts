import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { openReport, reportPathFor } from "./open.js";
import { createFileStorage } from "../storage/file.js";

describe("openReport", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "rescreen-open-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("отчёт есть — открывает его через системный браузер и сообщает путь", async () => {
    const storage = createFileStorage(join(root, ".rescreen"));
    const reportPath = reportPathFor(storage);
    await mkdir(storage.rootDir, { recursive: true });
    await writeFile(reportPath, "<html></html>");
    const opened: string[] = [];

    const result = await openReport({
      storage,
      opener: async (path) => {
        opened.push(path);
      },
    });

    expect(result.ok).toBe(true);
    expect(opened).toEqual([reportPath]);
    expect(result.message).toContain(reportPath);
  });

  it("отчёта нет — понятное сообщение, браузер не вызывается", async () => {
    const storage = createFileStorage(join(root, ".rescreen"));
    let called = false;

    const result = await openReport({
      storage,
      opener: async () => {
        called = true;
      },
    });

    expect(result.ok).toBe(false);
    expect(called).toBe(false);
    expect(result.message).toContain("Отчёт не найден");
    expect(result.message).toContain("rescreen run");
  });

  it("браузер не запустился — сообщение об ошибке", async () => {
    const storage = createFileStorage(join(root, ".rescreen"));
    const reportPath = reportPathFor(storage);
    await mkdir(storage.rootDir, { recursive: true });
    await writeFile(reportPath, "<html></html>");

    const result = await openReport({
      storage,
      opener: async () => {
        throw new Error("xdg-open: команда не найдена");
      },
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("xdg-open: команда не найдена");
  });
});
