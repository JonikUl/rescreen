import type { RunSummary } from "../runner/types.js";

/**
 * Русская плюрализация: выбирает форму существительного по числу.
 * `pluralize(1, "страница", "страницы", "страниц")` → "страница",
 * `pluralize(5, ...)` → "страниц". Формы: one — 1, few — 2–4, many — 0, 5–20;
 * сотни не влияют (21 → one), кроме 11–14 (→ many).
 */
export function pluralize(n: number, one: string, few: string, many: string): string {
  const mod100 = Math.abs(n) % 100;
  const mod10 = mod100 % 10;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

/**
 * Строка резюме прогона для CLI и HTML-отчёта — единственный источник формулировки.
 * Числительные с «страница»/«снимок» склоняются; остальные счётчики — «метка: число».
 */
export function formatSummaryLine(s: RunSummary): string {
  const pages = `${s.pages} ${pluralize(s.pages, "страница", "страницы", "страниц")}`;
  const total = `${s.total} ${pluralize(s.total, "снимок", "снимка", "снимков")}`;
  return `Проверено: ${pages} (${total}): без изменений ${s.unchanged}, изменилось ${s.diffs}, новых ${s.newBaselines}, пропущено ${s.skipped}, ошибок ${s.errors}`;
}
