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

/** Первая карточка результата в отчёте; бросает, если карточек нет. */
function firstCard(html: string): string {
  const card = html.split('<section class="card">')[1];
  if (card === undefined) throw new Error("в отчёте нет ни одной карточки");
  return card;
}

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
      summary: {
        pages: 2,
        total: 2,
        unchanged: 1,
        diffs: 1,
        newBaselines: 0,
        skipped: 0,
        errors: 0,
      },
    };

    const written = await createHtmlReporter(reportPath, { storage }).render(result);

    expect(written).toBe(reportPath);
    const html = await readFile(reportPath, "utf8");
    expect(html).toContain(
      "Проверено: 2 страницы (2 снимка): без изменений 1, изменилось 1, новых 0, пропущено 0, ошибок 0",
    );
    expect(html).toContain("Изменилась 1 страница из 2");
    expect(html).toContain("home");
    expect(html).toContain("about");
    expect(html).toContain("data:image/png;base64");
  });

  it("группирует результаты: изменились → ошибки → новые → без изменений → пропущенные; пустых групп нет", async () => {
    const storage = createFileStorage(join(root, ".rescreen"));
    const statuses = ["diff", "error", "new-baseline", "unchanged", "skipped"] as const;
    const result: RunResult = {
      startedAt: new Date("2026-10-11T10:00:00.000Z"),
      results: statuses.map((status, i) => ({
        key: { page: `page-${status}`, viewport: { width: 1440, height: 900 } },
        status,
        masksApplied: [],
        ...(status === "error" ? { error: "Сеть недоступна" } : {}),
        ...(status === "skipped" ? { warning: "Элемент не найден" } : {}),
        ...(status === "diff" || status === "unchanged" ? { diffRatio: 0.1 * (i + 1) } : {}),
      })),
      summary: {
        pages: 5,
        total: 5,
        unchanged: 1,
        diffs: 1,
        newBaselines: 1,
        skipped: 1,
        errors: 1,
      },
    };

    await createHtmlReporter(reportPath, { storage }).render(result);

    const html = await readFile(reportPath, "utf8");
    const groups = ["Изменились", "Ошибки", "Новые", "Без изменений", "Пропущенные"];
    const positions = groups.map((g) => html.indexOf(`<h2>${g} (`));
    for (const pos of positions) expect(pos).toBeGreaterThan(-1);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));

    for (const status of statuses) {
      const group = groups[statuses.indexOf(status)];
      const start = html.indexOf(`<h2>${group} (`);
      const end = html.indexOf("<h2>", start + 1);
      const section = html.slice(start, end === -1 ? undefined : end);
      expect(section).toContain(`page-${status}`);
    }
  });

  it("не рендерит пустые группы", async () => {
    const storage = createFileStorage(join(root, ".rescreen"));
    const result: RunResult = {
      startedAt: new Date(),
      results: [{ key: homeKey, status: "unchanged", diffRatio: 0, masksApplied: [] }],
      summary: {
        pages: 1,
        total: 1,
        unchanged: 1,
        diffs: 0,
        newBaselines: 0,
        skipped: 0,
        errors: 0,
      },
    };

    await createHtmlReporter(reportPath, { storage }).render(result);

    const html = await readFile(reportPath, "utf8");
    expect(html).toContain("<h2>Без изменений (1)</h2>");
    expect(html).not.toContain("<h2>Изменились");
    expect(html).not.toContain("<h2>Ошибки");
    expect(html).not.toContain("<h2>Новые");
    expect(html).not.toContain("<h2>Пропущенные");
  });

  it("diff показывает три изображения: «Было», «Стало» и «Diff» с подсветкой", async () => {
    const storage = createFileStorage(join(root, ".rescreen"));
    await storage.saveBaseline(makeSnapshot(homeKey, encodePng(createPng(4, 4))));
    await storage.saveCurrent(
      makeSnapshot(homeKey, encodePng(createPng(4, 4, { r: 255, g: 0, b: 0 }))),
    );
    await storage.saveDiff(homeKey, encodePng(createPng(4, 4, { r: 255, g: 255, b: 0 })));
    const result: RunResult = {
      startedAt: new Date(),
      results: [{ key: homeKey, status: "diff", diffRatio: 0.25, masksApplied: [] }],
      summary: {
        pages: 1,
        total: 1,
        unchanged: 0,
        diffs: 1,
        newBaselines: 0,
        skipped: 0,
        errors: 0,
      },
    };

    await createHtmlReporter(reportPath, { storage }).render(result);

    const card = firstCard(await readFile(reportPath, "utf8"));
    expect(card).toContain("Было (Baseline)");
    expect(card).toContain("Стало (текущий снимок)");
    expect(card).toContain(">Diff<");
    expect(card.match(/<img /g)).toHaveLength(3);
  });

  it("новый Baseline не показывает блок «Было»: на первом прогоне «было» не существует", async () => {
    const storage = createFileStorage(join(root, ".rescreen"));
    // Runner при new-baseline сохраняет и Baseline, и текущий Snapshot —
    // отчёт обязан проигнорировать Baseline в этой секции.
    await storage.saveBaseline(makeSnapshot(homeKey, encodePng(createPng(4, 4))));
    await storage.saveCurrent(makeSnapshot(homeKey, encodePng(createPng(4, 4))));
    const result: RunResult = {
      startedAt: new Date(),
      results: [{ key: homeKey, status: "new-baseline", masksApplied: [] }],
      summary: {
        pages: 1,
        total: 1,
        unchanged: 0,
        diffs: 0,
        newBaselines: 1,
        skipped: 0,
        errors: 0,
      },
    };

    await createHtmlReporter(reportPath, { storage }).render(result);

    const card = firstCard(await readFile(reportPath, "utf8"));
    expect(card).not.toContain("Было");
    expect(card).toContain("Стало");
    expect(card.match(/<img /g)).toHaveLength(1);
  });

  it("вердикт согласует глагол («Изменились 2 страницы») и упоминает пропущенные снимки", async () => {
    const storage = createFileStorage(join(root, ".rescreen"));
    const result: RunResult = {
      startedAt: new Date(),
      results: [
        { key: homeKey, status: "diff", diffRatio: 0.1, masksApplied: [] },
        { key: aboutKey, status: "diff", diffRatio: 0.2, masksApplied: [] },
        {
          key: { ...aboutKey, element: ".gone" },
          status: "skipped",
          masksApplied: [],
          warning: "Элемент не найден",
        },
      ],
      summary: {
        pages: 2,
        total: 3,
        unchanged: 0,
        diffs: 2,
        newBaselines: 0,
        skipped: 1,
        errors: 0,
      },
    };

    await createHtmlReporter(reportPath, { storage }).render(result);

    const html = await readFile(reportPath, "utf8");
    expect(html).toContain("Изменились 2 страницы из 2");
    expect(html).toContain("Пропущенные");
  });

  it("без Diff'ов, но с пропущенными: вердикт честно сообщает о пропусках", async () => {
    const storage = createFileStorage(join(root, ".rescreen"));
    const result: RunResult = {
      startedAt: new Date(),
      results: [
        { key: homeKey, status: "unchanged", diffRatio: 0, masksApplied: [] },
        {
          key: { ...homeKey, element: ".gone" },
          status: "skipped",
          masksApplied: [],
          warning: "Элемент не найден",
        },
      ],
      summary: {
        pages: 1,
        total: 2,
        unchanged: 1,
        diffs: 0,
        newBaselines: 0,
        skipped: 1,
        errors: 0,
      },
    };

    await createHtmlReporter(reportPath, { storage }).render(result);

    const html = await readFile(reportPath, "utf8");
    expect(html).not.toContain("Изменений не обнаружено.");
    expect(html).toContain("Пропущено: 1");
  });

  it("«Изменились» развёрнуты, «Без изменений» и «Пропущенные» свёрнуты (story 30)", async () => {
    const storage = createFileStorage(join(root, ".rescreen"));
    await storage.saveBaseline(makeSnapshot(homeKey, encodePng(createPng(4, 4))));
    await storage.saveCurrent(
      makeSnapshot(homeKey, encodePng(createPng(4, 4, { r: 255, g: 0, b: 0 }))),
    );
    await storage.saveDiff(homeKey, encodePng(createPng(4, 4)));
    const result: RunResult = {
      startedAt: new Date(),
      results: [
        { key: homeKey, status: "diff", diffRatio: 0.25, masksApplied: [] },
        { key: aboutKey, status: "unchanged", diffRatio: 0, masksApplied: [] },
        {
          key: { ...aboutKey, element: ".missing" },
          status: "skipped",
          masksApplied: [],
          warning: 'Element ".missing" не найден на странице "about"',
        },
      ],
      summary: {
        pages: 2,
        total: 3,
        unchanged: 1,
        diffs: 1,
        newBaselines: 0,
        skipped: 1,
        errors: 0,
      },
    };

    await createHtmlReporter(reportPath, { storage }).render(result);

    const html = await readFile(reportPath, "utf8");
    expect(html).toContain('<details open class="group">');
    const changedIdx = html.indexOf("<h2>Изменились (1)</h2>");
    expect(html.lastIndexOf("<details", changedIdx)).toBe(
      html.lastIndexOf('<details open class="group">', changedIdx),
    );
    const unchangedIdx = html.indexOf("<h2>Без изменений (1)</h2>");
    const skippedIdx = html.indexOf("<h2>Пропущенные (1)</h2>");
    for (const idx of [unchangedIdx, skippedIdx]) {
      expect(html.lastIndexOf("<details", idx)).toBe(
        html.lastIndexOf('<details class="group">', idx),
      );
    }
  });

  it("элементные Snapshot'ы показаны наравне со страничными: селектор в заголовке, та же группа", async () => {
    const storage = createFileStorage(join(root, ".rescreen"));
    const elementKey: SnapshotKey = { ...homeKey, element: ".main-nav" };
    await storage.saveBaseline(makeSnapshot(elementKey, encodePng(createPng(4, 4))));
    await storage.saveCurrent(
      makeSnapshot(elementKey, encodePng(createPng(4, 4, { r: 255, g: 0, b: 0 }))),
    );
    await storage.saveDiff(elementKey, encodePng(createPng(4, 4)));
    const result: RunResult = {
      startedAt: new Date(),
      results: [
        { key: elementKey, status: "diff", diffRatio: 0.5, masksApplied: [] },
        { key: homeKey, status: "unchanged", diffRatio: 0, masksApplied: [] },
      ],
      summary: {
        pages: 1,
        total: 2,
        unchanged: 1,
        diffs: 1,
        newBaselines: 0,
        skipped: 0,
        errors: 0,
      },
    };

    await createHtmlReporter(reportPath, { storage }).render(result);

    const html = await readFile(reportPath, "utf8");
    const changedGroup = html.slice(
      html.indexOf("<h2>Изменились (1)</h2>"),
      html.indexOf("<h2>Без изменений (1)</h2>"),
    );
    expect(changedGroup).toContain("home");
    expect(changedGroup).toContain(".main-nav");
    expect(changedGroup).toContain("Было (Baseline)");
  });

  it("включает в отчёт описание ошибки для результатов со статусом error", async () => {
    const storage = createFileStorage(join(root, ".rescreen"));
    const result: RunResult = {
      startedAt: new Date(),
      results: [{ key: homeKey, status: "error", masksApplied: [], error: "Сеть недоступна" }],
      summary: {
        pages: 1,
        total: 1,
        unchanged: 0,
        diffs: 0,
        newBaselines: 0,
        skipped: 0,
        errors: 1,
      },
    };

    await createHtmlReporter(reportPath, { storage }).render(result);

    const html = await readFile(reportPath, "utf8");
    expect(html).toContain("ошибка");
    expect(html).toContain("Сеть недоступна");
  });

  it("показывает применённые Mask'и («Не проверялось») только когда они есть", async () => {
    const storage = createFileStorage(join(root, ".rescreen"));
    const result: RunResult = {
      startedAt: new Date(),
      results: [
        { key: homeKey, status: "unchanged", diffRatio: 0, masksApplied: [".cookie", "#chat"] },
        { key: aboutKey, status: "unchanged", diffRatio: 0, masksApplied: [] },
      ],
      summary: {
        pages: 2,
        total: 2,
        unchanged: 2,
        diffs: 0,
        newBaselines: 0,
        skipped: 0,
        errors: 0,
      },
    };

    await createHtmlReporter(reportPath, { storage }).render(result);

    const html = await readFile(reportPath, "utf8");
    expect(html).toContain("Не проверялось (маски): .cookie, #chat");
    // легенда объясняет штриховку на снимках нетехнической аудитории
    expect(html).toContain("полосатые области");
    // секция без масок не получает строку про маскирование
    const aboutSection = html.split('<section class="card">').find((s) => s.includes("about"));
    expect(aboutSection).not.toContain("Не проверялось");
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
      summary: {
        pages: 1,
        total: 1,
        unchanged: 1,
        diffs: 0,
        newBaselines: 0,
        skipped: 0,
        errors: 0,
      },
    };

    await createHtmlReporter(reportPath, { storage }).render(result);

    const html = await readFile(reportPath, "utf8");
    expect(html).toContain("⚠");
    expect(html).not.toContain("Предупреждение");
    expect(html).toContain("Стабильный кадр не достигнут");
  });
});
