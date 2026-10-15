import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import fc from "fast-check";

import { loadConfig, resolveConfig, validateConfig } from "./loader.js";
import { ConfigError } from "./types.js";

// Путь к корневому index.ts вычисляется от этого файла — без машинно-зависимых путей
const indexModule = fileURLToPath(new URL("../index.ts", import.meta.url));

describe("loadConfig", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "rescreen-config-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("загружает rescreen.config.ts через jiti и возвращает конфиг", async () => {
    await writeFile(
      join(dir, "rescreen.config.ts"),
      [
        `import { defineConfig } from ${JSON.stringify(indexModule)};`,
        "export default defineConfig({",
        "  baseUrl: 'https://example.com',",
        "  pages: [{ name: 'home', path: '/' }],",
        "});",
      ].join("\n"),
    );

    const config = await loadConfig(dir);

    expect(config.baseUrl).toBe("https://example.com");
    expect(config.pages).toHaveLength(1);
    expect(config.pages[0]?.name).toBe("home");
  });

  it("ConfigError, если файла конфигурации нет", async () => {
    await expect(loadConfig(dir)).rejects.toThrow(ConfigError);
    await expect(loadConfig(dir)).rejects.toThrow(/rescreen\.config\.ts/);
  });

  it("ConfigError, если pages пустой", async () => {
    await writeFile(
      join(dir, "rescreen.config.ts"),
      `export default { baseUrl: "https://example.com", pages: [] };`,
    );

    await expect(loadConfig(dir)).rejects.toThrow(ConfigError);
    await expect(loadConfig(dir)).rejects.toThrow(/pages/);
  });

  it("ConfigError, если pages отсутствует", async () => {
    await writeFile(
      join(dir, "rescreen.config.ts"),
      `export default { baseUrl: "https://example.com" };`,
    );

    await expect(loadConfig(dir)).rejects.toThrow(ConfigError);
  });

  it("ConfigError, если baseUrl — не URL", async () => {
    await writeFile(
      join(dir, "rescreen.config.ts"),
      `export default { baseUrl: "example.com", pages: [{ name: "home", path: "/" }] };`,
    );

    await expect(loadConfig(dir)).rejects.toThrow(ConfigError);
    await expect(loadConfig(dir)).rejects.toThrow(/baseUrl/);
  });

  it("ConfigError, если baseUrl — не http(s) URL", async () => {
    await writeFile(
      join(dir, "rescreen.config.ts"),
      `export default { baseUrl: "ftp://example.com", pages: [{ name: "home", path: "/" }] };`,
    );

    await expect(loadConfig(dir)).rejects.toThrow(ConfigError);
    await expect(loadConfig(dir)).rejects.toThrow(/baseUrl/);
  });

  it("ConfigError, если path не начинается с /", async () => {
    await writeFile(
      join(dir, "rescreen.config.ts"),
      `export default { baseUrl: "https://example.com", pages: [{ name: "home", path: "news" }] };`,
    );

    await expect(loadConfig(dir)).rejects.toThrow(ConfigError);
    await expect(loadConfig(dir)).rejects.toThrow(/home/);
    await expect(loadConfig(dir)).rejects.toThrow(/path/);
  });

  it("ConfigError, если глобальный mask содержит пустой селектор", async () => {
    await writeFile(
      join(dir, "rescreen.config.ts"),
      `export default { baseUrl: "https://example.com", mask: [".cookie", ""], pages: [{ name: "home", path: "/" }] };`,
    );

    await expect(loadConfig(dir)).rejects.toThrow(ConfigError);
    await expect(loadConfig(dir)).rejects.toThrow(/mask/);
  });

  it("ConfigError, если mask — не массив строк", async () => {
    await writeFile(
      join(dir, "rescreen.config.ts"),
      `export default { baseUrl: "https://example.com", mask: ".cookie", pages: [{ name: "home", path: "/" }] };`,
    );

    await expect(loadConfig(dir)).rejects.toThrow(ConfigError);
    await expect(loadConfig(dir)).rejects.toThrow(/mask/);
  });

  it("ConfigError, если per-page mask содержит пустой селектор", async () => {
    await writeFile(
      join(dir, "rescreen.config.ts"),
      `export default { baseUrl: "https://example.com", pages: [{ name: "home", path: "/", mask: ["  "] }] };`,
    );

    await expect(loadConfig(dir)).rejects.toThrow(ConfigError);
    await expect(loadConfig(dir)).rejects.toThrow(/home/);
  });

  it("ConfigError, если elements содержит пустой селектор", async () => {
    await writeFile(
      join(dir, "rescreen.config.ts"),
      `export default { baseUrl: "https://example.com", pages: [{ name: "home", path: "/", elements: [""] }] };`,
    );

    await expect(loadConfig(dir)).rejects.toThrow(ConfigError);
    await expect(loadConfig(dir)).rejects.toThrow(/elements/);
  });

  it("ConfigError при отрицательном threshold (глобальный)", async () => {
    await writeFile(
      join(dir, "rescreen.config.ts"),
      `export default { baseUrl: "https://example.com", threshold: -0.1, pages: [{ name: "home", path: "/" }] };`,
    );

    await expect(loadConfig(dir)).rejects.toThrow(ConfigError);
    await expect(loadConfig(dir)).rejects.toThrow(/threshold/);
  });

  it("ConfigError при threshold больше 1 и при NaN (per-page)", async () => {
    await writeFile(
      join(dir, "rescreen.config.ts"),
      `export default { baseUrl: "https://example.com", pages: [{ name: "home", path: "/", threshold: 1.5 }] };`,
    );

    await expect(loadConfig(dir)).rejects.toThrow(ConfigError);
    await expect(loadConfig(dir)).rejects.toThrow(/home/);

    await writeFile(
      join(dir, "rescreen.config.ts"),
      `export default { baseUrl: "https://example.com", pages: [{ name: "home", path: "/", threshold: NaN }] };`,
    );

    await expect(loadConfig(dir)).rejects.toThrow(ConfigError);
    await expect(loadConfig(dir)).rejects.toThrow(/threshold/);
  });

  it("ConfigError, если threshold — не число", async () => {
    await writeFile(
      join(dir, "rescreen.config.ts"),
      `export default { baseUrl: "https://example.com", threshold: "0.1", pages: [{ name: "home", path: "/" }] };`,
    );

    await expect(loadConfig(dir)).rejects.toThrow(ConfigError);
    await expect(loadConfig(dir)).rejects.toThrow(/threshold/);
  });

  it("граничные threshold 0 и 1 — валидны", async () => {
    await writeFile(
      join(dir, "rescreen.config.ts"),
      `export default { baseUrl: "https://example.com", threshold: 0, pages: [{ name: "home", path: "/", threshold: 1 }] };`,
    );

    const config = await loadConfig(dir);
    expect(config.threshold).toBe(0);
    expect(config.pages[0]?.threshold).toBe(1);
  });

  it("ConfigError при нулевом width в глобальном viewport", async () => {
    await writeFile(
      join(dir, "rescreen.config.ts"),
      `export default { baseUrl: "https://example.com", viewport: { width: 0, height: 900 }, pages: [{ name: "home", path: "/" }] };`,
    );

    await expect(loadConfig(dir)).rejects.toThrow(ConfigError);
    await expect(loadConfig(dir)).rejects.toThrow(/viewport/);
  });

  it("ConfigError при отрицательном height и нецелом width (per-page)", async () => {
    await writeFile(
      join(dir, "rescreen.config.ts"),
      `export default { baseUrl: "https://example.com", pages: [{ name: "home", path: "/", viewport: { width: 800, height: -600 } }] };`,
    );

    await expect(loadConfig(dir)).rejects.toThrow(ConfigError);
    await expect(loadConfig(dir)).rejects.toThrow(/home/);

    await writeFile(
      join(dir, "rescreen.config.ts"),
      `export default { baseUrl: "https://example.com", pages: [{ name: "home", path: "/", viewport: { width: 800.5, height: 600 } }] };`,
    );

    await expect(loadConfig(dir)).rejects.toThrow(ConfigError);
    await expect(loadConfig(dir)).rejects.toThrow(/viewport/);
  });

  it("ConfigError, если viewport — не объект с width/height", async () => {
    await writeFile(
      join(dir, "rescreen.config.ts"),
      `export default { baseUrl: "https://example.com", viewport: "1440x900", pages: [{ name: "home", path: "/" }] };`,
    );

    await expect(loadConfig(dir)).rejects.toThrow(ConfigError);
    await expect(loadConfig(dir)).rejects.toThrow(/viewport/);
  });

  it("ConfigError, если имя Page содержит символы вне slug-алфавита", async () => {
    await writeFile(
      join(dir, "rescreen.config.ts"),
      `export default { baseUrl: "https://example.com", pages: [{ name: "главная страница", path: "/" }] };`,
    );

    await expect(loadConfig(dir)).rejects.toThrow(ConfigError);
    await expect(loadConfig(dir)).rejects.toThrow(/главная страница/);
    await expect(loadConfig(dir)).rejects.toThrow(/a-zA-Z0-9/);
  });

  it("ConfigError при дублирующихся именах Page", async () => {
    await writeFile(
      join(dir, "rescreen.config.ts"),
      `export default { baseUrl: "https://example.com", pages: [{ name: "home", path: "/" }, { name: "home", path: "/home" }] };`,
    );

    await expect(loadConfig(dir)).rejects.toThrow(ConfigError);
    await expect(loadConfig(dir)).rejects.toThrow(/home/);
  });
});

describe("resolveConfig", () => {
  const config = {
    baseUrl: "https://example.com",
    pages: [
      { name: "home", path: "/" },
      {
        name: "news",
        path: "/news",
        viewport: { width: 800, height: 600 },
        threshold: 0.5,
        mask: [".date"],
      },
    ],
  };

  it("применяет значения по умолчанию: viewport 1440×900, threshold 0, пустые mask/elements", () => {
    const resolved = resolveConfig(config);

    expect(resolved.pages[0]).toEqual({
      name: "home",
      path: "/",
      viewport: { width: 1440, height: 900 },
      mask: [],
      threshold: 0,
      elements: [],
    });
  });

  it("сохраняет per-page переопределения viewport, threshold и mask", () => {
    const resolved = resolveConfig(config);

    expect(resolved.pages[1]?.viewport).toEqual({ width: 800, height: 600 });
    expect(resolved.pages[1]?.threshold).toBe(0.5);
    expect(resolved.pages[1]?.mask).toEqual([".date"]);
  });

  it("наследует глобальный viewport и threshold, не мутирует вход и сохраняет порядок Page", () => {
    const input = {
      baseUrl: "https://example.com",
      viewport: { width: 1280, height: 720 },
      threshold: 0.1,
      pages: [{ name: "a", path: "/a" }],
    };
    const resolved = resolveConfig(input);

    expect(resolved.pages[0]?.viewport).toEqual({ width: 1280, height: 720 });
    expect(resolved.pages[0]?.threshold).toBe(0.1);
    expect(resolved.mask).toEqual([]);
    expect(input.pages[0]).toEqual({ name: "a", path: "/a" });
    expect(resolved.pages.map((p) => p.name)).toEqual(["a"]);
  });
});

describe("validateConfig (property-based)", () => {
  const FILE = "rescreen.config.ts";
  const slugChar = fc.constantFrom(
    ..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_".split(""),
  );
  const arbName = fc.string({ unit: slugChar, minLength: 1, maxLength: 24 });
  const arbSelector = fc.string({ minLength: 1, maxLength: 30 }).filter((s) => s.trim().length > 0);
  const arbViewport = fc.record({
    width: fc.integer({ min: 1, max: 10000 }),
    height: fc.integer({ min: 1, max: 10000 }),
  });
  const arbThreshold = fc.double({ min: 0, max: 1, noNaN: true });
  const arbPage = fc.record({
    name: arbName,
    path: fc.string({ maxLength: 30 }).map((s) => `/${s}`),
    viewport: fc.option(arbViewport, { nil: undefined }),
    mask: fc.option(fc.array(arbSelector, { maxLength: 3 }), { nil: undefined }),
    threshold: fc.option(arbThreshold, { nil: undefined }),
    elements: fc.option(fc.array(arbSelector, { maxLength: 3 }), { nil: undefined }),
  });
  const arbValidConfig = fc.record({
    baseUrl: fc.webUrl(),
    viewport: fc.option(arbViewport, { nil: undefined }),
    mask: fc.option(fc.array(arbSelector, { maxLength: 3 }), { nil: undefined }),
    threshold: fc.option(arbThreshold, { nil: undefined }),
    pages: fc.uniqueArray(arbPage, { selector: (p) => p.name, minLength: 1, maxLength: 5 }),
  });

  it("property: любой сгенерированный валидный конфиг проходит валидацию и resolveConfig", () => {
    fc.assert(
      fc.property(arbValidConfig, (config) => {
        const validated = validateConfig(config, FILE);
        const resolved = resolveConfig(validated);
        expect(resolved.pages).toHaveLength(config.pages.length);
        expect(resolved.baseUrl).toBe(config.baseUrl);
      }),
    );
  });

  it("property: произвольный мусор либо валиден, либо даёт ConfigError с непустым сообщением — никаких падений", () => {
    fc.assert(
      fc.property(fc.anything(), (raw) => {
        try {
          const validated = validateConfig(raw, FILE);
          // если валидация прошла, результат обязан удовлетворять инвариантам схемы
          expect(typeof validated.baseUrl).toBe("string");
          expect(validated.pages.length).toBeGreaterThan(0);
        } catch (err) {
          expect(err).toBeInstanceOf(ConfigError);
          expect((err as Error).message.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 500 },
    );
  });

  it("property: любое имя Page вне slug-алфавита даёт ConfigError", () => {
    const arbBadName = fc
      .string({ minLength: 1, maxLength: 24 })
      .filter((s) => !/^[a-zA-Z0-9_-]+$/.test(s));

    fc.assert(
      fc.property(arbBadName, (name) => {
        expect(() =>
          validateConfig({ baseUrl: "https://example.com", pages: [{ name, path: "/" }] }, FILE),
        ).toThrow(ConfigError);
      }),
    );
  });

  it("property: любой threshold вне [0, 1] даёт ConfigError", () => {
    const arbBadThreshold = fc.oneof(
      fc.double({ min: 1.000001, max: 1e9, noNaN: true }),
      fc.double({ min: -1e9, max: -0.000001, noNaN: true }),
      fc.constant(Number.NaN),
      fc.constant(Number.POSITIVE_INFINITY),
    );

    fc.assert(
      fc.property(arbBadThreshold, (threshold) => {
        expect(() =>
          validateConfig(
            { baseUrl: "https://example.com", pages: [{ name: "home", path: "/", threshold }] },
            FILE,
          ),
        ).toThrow(ConfigError);
      }),
    );
  });
});
