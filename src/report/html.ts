import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { createFileStorage } from "../storage/file.js";
import type { BaselineStorage } from "../storage/types.js";
import type { RunResult, SnapshotResult } from "../runner/types.js";
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
  error: "ошибка",
};

/**
 * Reporter в один самодостаточный HTML-файл на русском языке:
 * изображения встроены как base64 data URI, файл открывается без сервера.
 * Намеренно примитивен (дизайн — ticket 07).
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

async function renderDocument(result: RunResult, storage: BaselineStorage): Promise<string> {
  const s = result.summary;
  const sections: string[] = [];

  for (const r of result.results) {
    sections.push(await renderSection(r, storage));
  }

  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>rescreen — отчёт о визуальной проверке</title>
</head>
<body>
<h1>rescreen — отчёт о визуальной проверке</h1>
<p>Проверено ${s.total} страниц: без изменений ${s.unchanged}, изменилось ${s.diffs}, новых ${s.newBaselines}, ошибок ${s.errors}</p>
${sections.join("\n")}
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
    `<section>`,
    `<h2>${title}</h2>`,
    `<p>Статус: ${STATUS_LABELS[result.status]}${details}</p>`,
  ];
  if (result.warning !== undefined) {
    lines.push(`<p>Предупреждение: ${escapeHtml(result.warning)}</p>`);
  }
  if (result.error !== undefined) {
    lines.push(`<p>Ошибка: ${escapeHtml(result.error)}</p>`);
  }

  if (result.status === "diff" || result.status === "new-baseline") {
    const baseline = await storage.getBaseline(key);
    const current = result.status === "diff" ? await storage.getCurrent(key) : null;
    const diff = result.status === "diff" ? await storage.getDiff(key) : null;
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
