import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { loadConfig, resolveConfig } from "./loader.js";
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
