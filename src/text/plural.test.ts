import { describe, expect, it } from "vite-plus/test";

import { formatSummaryLine, pluralize } from "./plural.js";
import type { RunSummary } from "../runner/types.js";

describe("pluralize", () => {
  const forms: [string, string, string] = ["страница", "страницы", "страниц"];
  const word = (n: number): string => pluralize(n, ...forms);

  it("1 → единственное число", () => {
    expect(word(1)).toBe("страница");
  });

  it("2–4 → форма few", () => {
    expect(word(2)).toBe("страницы");
    expect(word(3)).toBe("страницы");
    expect(word(4)).toBe("страницы");
  });

  it("5–20 → форма many", () => {
    expect(word(0)).toBe("страниц");
    expect(word(5)).toBe("страниц");
    expect(word(11)).toBe("страниц");
    expect(word(14)).toBe("страниц");
    expect(word(20)).toBe("страниц");
  });

  it("сотни не влияют: 21/22/25 склоняются как 1/2/5, кроме 11–14", () => {
    expect(word(21)).toBe("страница");
    expect(word(22)).toBe("страницы");
    expect(word(25)).toBe("страниц");
    expect(word(101)).toBe("страница");
    expect(word(111)).toBe("страниц");
  });
});

describe("formatSummaryLine", () => {
  const summary = (overrides: Partial<RunSummary>): RunSummary => ({
    pages: 0,
    total: 0,
    unchanged: 0,
    diffs: 0,
    newBaselines: 0,
    skipped: 0,
    errors: 0,
    ...overrides,
  });

  it("склоняет «страница» и «снимок» по-русски", () => {
    expect(formatSummaryLine(summary({ pages: 1, total: 2, diffs: 2 }))).toBe(
      "Проверено: 1 страница (2 снимка): без изменений 0, изменилось 2, новых 0, пропущено 0, ошибок 0",
    );
  });

  it("множественное число", () => {
    expect(
      formatSummaryLine(
        summary({ pages: 20, total: 25, unchanged: 17, diffs: 3, newBaselines: 4, skipped: 1 }),
      ),
    ).toBe(
      "Проверено: 20 страниц (25 снимков): без изменений 17, изменилось 3, новых 4, пропущено 1, ошибок 0",
    );
  });

  it("пограничные склонения (5 страниц, 21 снимок)", () => {
    expect(formatSummaryLine(summary({ pages: 5, total: 21 }))).toContain(
      "Проверено: 5 страниц (21 снимок):",
    );
  });
});
