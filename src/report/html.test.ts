import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { createHtmlReporter } from "./html.js";
import { createFileStorage } from "../storage/file.js";
import { createPng, encodePng, makeSnapshot } from "../test-utils/png.js";
import type { RunResult } from "../runner/types.js";
import type { SnapshotKey } from "../snapshot/types.js";

const homeKey: SnapshotKey = { page: "home", viewport: { width: 1440, height: 900 } };
const aboutKey: SnapshotKey = { page: "about", viewport: { width: 1440, height: 900 } };

describe("Reporter (HTML)", () => {
  let root: string;
  let reportPath: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "rescreen-report-"));
    reportPath = join(root, "report.html");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("рендерит самодостаточный HTML: резюме на русском и изображения в base64", async () => {
    const storage = createFileStorage(join(root, ".rescreen"));
    await storage.saveBaseline(
      makeSnapshot(homeKey, encodePng(createPng(4, 4, { r: 0, g: 0, b: 0 }))),
    );
    await storage.saveCurrent(
      makeSnapshot(homeKey, encodePng(createPng(4, 4, { r: 255, g: 0, b: 0 }))),
    );
    await storage.saveDiff(homeKey, encodePng(createPng(4, 4, { r: 255, g: 255, b: 0 })));
    await storage.saveBaseline(makeSnapshot(aboutKey, encodePng(createPng(4, 4))));

    const result: RunResult = {
      startedAt: new Date("2026-10-11T10:00:00.000Z"),
      results: [
        { key: homeKey, status: "diff", diffRatio: 0.25, masksApplied: [".cookie-banner"] },
        { key: aboutKey, status: "unchanged", diffRatio: 0, masksApplied: [] },
      ],
      summary: { total: 2, unchanged: 1, diffs: 1, newBaselines: 0, errors: 0 },
    };

    const written = await createHtmlReporter(reportPath, { storage }).render(result);

    expect(written).toBe(reportPath);
    const html = await readFile(reportPath, "utf8");
    expect(html).toContain("Проверено 2 страниц: без изменений 1, изменилось 1, новых 0, ошибок 0");
    expect(html).toContain("home");
    expect(html).toContain("about");
    expect(html).toContain("data:image/png;base64");
  });

  it("включает в отчёт описание ошибки для результатов со статусом error", async () => {
    const storage = createFileStorage(join(root, ".rescreen"));
    const result: RunResult = {
      startedAt: new Date(),
      results: [{ key: homeKey, status: "error", masksApplied: [], error: "Сеть недоступна" }],
      summary: { total: 1, unchanged: 0, diffs: 0, newBaselines: 0, errors: 1 },
    };

    await createHtmlReporter(reportPath, { storage }).render(result);

    const html = await readFile(reportPath, "utf8");
    expect(html).toContain("ошибка");
    expect(html).toContain("Сеть недоступна");
  });

  it("показывает применённые Mask'и («Скрыто масками») только когда они есть", async () => {
    const storage = createFileStorage(join(root, ".rescreen"));
    const result: RunResult = {
      startedAt: new Date(),
      results: [
        { key: homeKey, status: "unchanged", diffRatio: 0, masksApplied: [".cookie", "#chat"] },
        { key: aboutKey, status: "unchanged", diffRatio: 0, masksApplied: [] },
      ],
      summary: { total: 2, unchanged: 2, diffs: 0, newBaselines: 0, errors: 0 },
    };

    await createHtmlReporter(reportPath, { storage }).render(result);

    const html = await readFile(reportPath, "utf8");
    expect(html).toContain("Скрыто масками: .cookie, #chat");
    // секция без масок не получает строку про маскирование
    const aboutSection = html.split("<section>").find((s) => s.includes("about"));
    expect(aboutSection).not.toContain("Скрыто масками");
  });

  it("включает в отчёт предупреждение для результата с warning", async () => {
    const storage = createFileStorage(join(root, ".rescreen"));
    const result: RunResult = {
      startedAt: new Date(),
      results: [
        {
          key: homeKey,
          status: "unchanged",
          diffRatio: 0,
          masksApplied: [],
          warning: "Стабильный кадр не достигнут за 5000 мс — используется последний кадр",
        },
      ],
      summary: { total: 1, unchanged: 1, diffs: 0, newBaselines: 0, errors: 0 },
    };

    await createHtmlReporter(reportPath, { storage }).render(result);

    const html = await readFile(reportPath, "utf8");
    expect(html).toContain("Предупреждение");
    expect(html).toContain("Стабильный кадр не достигнут");
  });
});
