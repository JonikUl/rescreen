import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { createFileStorage } from "../storage/file.js";
import type { BaselineStorage } from "../storage/types.js";
import type { RunResult, SnapshotResult } from "../runner/types.js";
import { formatSummaryLine, pluralize } from "../text/plural.js";
import type { Reporter } from "./types.js";

export interface HtmlReporterDeps {
  /**
   * Хранилище с результатами Run'а (текущие Snapshot'ы, Diff'ы).
   * По умолчанию — файловое хранилище в `.rescreen` текущей директории.
   */
  readonly storage?: BaselineStorage;
}

const STATUS_LABELS: Record<SnapshotResult["status"], string> = {
  "new-baseline": "новый Baseline",
  unchanged: "без изменений",
  diff: "изменилось",
  skipped: "пропущен",
  error: "ошибка",
};

/** Группы отчёта в порядке показа: важное — вверху (spec, stories 28–30). */
const GROUPS: readonly { status: SnapshotResult["status"]; title: string; open: boolean }[] = [
  { status: "diff", title: "Изменились", open: true },
  { status: "error", title: "Ошибки", open: true },
  { status: "new-baseline", title: "Новые", open: true },
  { status: "unchanged", title: "Без изменений", open: false },
  { status: "skipped", title: "Пропущенные", open: false },
];

const STYLES = `
body { font-family: system-ui, sans-serif; margin: 0 auto; max-width: 1200px; padding: 16px; color: #222; }
h1 { font-size: 24px; }
.group { margin: 12px 0; }
.group > summary { cursor: pointer; }
.group > summary h2 { display: inline; font-size: 18px; }
.card { border: 1px solid #ddd; border-radius: 8px; padding: 12px 16px; margin: 12px 0; }
.card h3 { margin-top: 0; font-size: 16px; }
.card .warning { color: #8a6d00; }
.card .error { color: #b00020; }
.images { display: flex; flex-wrap: wrap; gap: 16px; }
.images figure { margin: 0; flex: 1 1 300px; min-width: 0; }
.images figcaption { font-size: 13px; color: #555; margin-bottom: 4px; }
.images img { max-width: 100%; border: 1px solid #ccc; }
`;

/**
 * Reporter в один самодостаточный HTML-файл на русском языке:
 * изображения встроены как base64 data URI, файл открывается без сервера.
 */
export function createHtmlReporter(outputPath: string, deps: HtmlReporterDeps = {}): Reporter {
  const storage: BaselineStorage = deps.storage ?? createFileStorage();

  return {
    async render(result: RunResult): Promise<string> {
      const html = await renderDocument(result, storage);
      const file = resolve(outputPath);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, html, "utf8");
      return file;
    },
  };
}

/** Резюме человеческим языком (spec, story 28): масштаб изменений одной фразой. */
function humanVerdict(result: RunResult): string {
  const s = result.summary;
  const diffPages = new Set(
    result.results.filter((r) => r.status === "diff").map((r) => r.key.page),
  ).size;

  const parts: string[] = [];
  if (diffPages > 0) {
    const verb = pluralize(diffPages, "Изменилась", "Изменились", "Изменилось");
    parts.push(
      `${verb} ${diffPages} ${pluralize(diffPages, "страница", "страницы", "страниц")} из ${s.pages}.`,
    );
  } else if (s.errors === 0 && s.skipped === 0) {
    parts.push("Изменений не обнаружено.");
  }
  if (s.newBaselines > 0) {
    parts.push(
      `Создано ${s.newBaselines} ${pluralize(s.newBaselines, "новый Baseline", "новых Baseline'а", "новых Baseline'ов")}.`,
    );
  }
  if (s.errors > 0) {
    parts.push(`Ошибок: ${s.errors} — см. раздел «Ошибки».`);
  }
  if (s.skipped > 0) {
    parts.push(`Пропущено: ${s.skipped} — см. раздел «Пропущенные».`);
  }
  return parts.join(" ");
}

async function renderDocument(result: RunResult, storage: BaselineStorage): Promise<string> {
  const groups: string[] = [];

  for (const group of GROUPS) {
    const items = result.results.filter((r) => r.status === group.status);
    if (items.length === 0) continue;
    const cards: string[] = [];
    for (const r of items) {
      cards.push(await renderSection(r, storage));
    }
    groups.push(`<details${group.open ? " open" : ""} class="group">
<summary><h2>${group.title} (${items.length})</h2></summary>
${cards.join("\n")}
</details>`);
  }

  const when = new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "long",
    timeStyle: "short",
  }).format(result.startedAt);

  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>rescreen — отчёт о визуальной проверке</title>
<style>${STYLES}</style>
</head>
<body>
<h1>Отчёт о визуальной проверке</h1>
<p>Прогон от ${escapeHtml(when)}</p>
<p>${escapeHtml(humanVerdict(result))}</p>
<p>${escapeHtml(formatSummaryLine(result.summary))}</p>
<p>Серые полосатые области на снимках — замаскированные: они не проверялись.</p>
${groups.join("\n")}
</body>
</html>
`;
}

async function renderSection(result: SnapshotResult, storage: BaselineStorage): Promise<string> {
  const { key } = result;
  const title = escapeHtml(
    `${key.page} (${key.viewport.width}×${key.viewport.height}${key.element === undefined ? "" : ` :: ${key.element}`})`,
  );

  let details = "";
  if (result.status === "diff") {
    details = ` — ${((result.diffRatio ?? 0) * 100).toFixed(2)}% пикселей`;
  }
  const lines: string[] = [
    `<section class="card">`,
    `<h3>${title}</h3>`,
    `<p>Статус: ${STATUS_LABELS[result.status]}${details}</p>`,
  ];
  if (result.warning !== undefined) {
    lines.push(`<p class="warning">⚠ ${escapeHtml(result.warning)}</p>`);
  }
  if (result.masksApplied.length > 0) {
    lines.push(`<p>Не проверялось (маски): ${escapeHtml(result.masksApplied.join(", "))}</p>`);
  }
  if (result.error !== undefined) {
    lines.push(`<p class="error">Ошибка: ${escapeHtml(result.error)}</p>`);
  }

  if (result.status === "diff") {
    const baseline = await storage.getBaseline(key);
    const current = await storage.getCurrent(key);
    const diff = await storage.getDiff(key);
    lines.push(`<div class="images">`);
    if (baseline !== null) {
      lines.push(figure("Было (Baseline)", baseline.png));
    }
    if (current !== null) {
      lines.push(figure("Стало (текущий снимок)", current.png));
    }
    if (diff !== null) {
      lines.push(figure("Diff", diff));
    }
    lines.push(`</div>`);
  }
  if (result.status === "new-baseline") {
    // «Было» на первом прогоне не существует — Baseline создан из этого же снимка.
    const current = await storage.getCurrent(key);
    if (current !== null) {
      lines.push(`<div class="images">`);
      lines.push(figure("Стало (новый Baseline)", current.png));
      lines.push(`</div>`);
    }
  }

  lines.push(`</section>`);
  return lines.join("\n");
}

function figure(caption: string, png: Uint8Array): string {
  const uri = `data:image/png;base64,${Buffer.from(png).toString("base64")}`;
  return `<figure><figcaption>${escapeHtml(caption)}</figcaption><img src="${uri}" alt="${escapeHtml(caption)}"></figure>`;
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
