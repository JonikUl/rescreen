import { access } from "node:fs/promises";
import { join, resolve } from "node:path";

import { createJiti } from "jiti";

import { ConfigError, DEFAULT_THRESHOLD, DEFAULT_VIEWPORT } from "./types.js";
import type { RescreenConfig, ResolvedConfig, ResolvedPageConfig } from "./types.js";

const CONFIG_FILES = ["rescreen.config.ts", "rescreen.config.js", "rescreen.config.mjs"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNotFound(err: unknown): boolean {
  return isRecord(err) && err.code === "ENOENT";
}

/**
 * Загружает конфиг из `rescreen.config.ts` (расширения .js/.mjs — fallback).
 *
 * Постусловие: возвращённый конфиг удовлетворяет структурным инвариантам схемы:
 * непустые `baseUrl`, `pages`, `name`/`path` каждой Page.
 *
 * Ошибки: {@link ConfigError} с человекочитаемым сообщением на русском,
 * если файл не найден или структурный инвариант нарушен — до старта любого Run.
 *
 * Пока НЕ проверяется (глубокая валидация — ticket 08): валидность URL,
 * начало path с `/`, непустота селекторов, threshold ∈ [0, 1], уникальность name,
 * допустимость символов name (см. предусловие {@link SnapshotKey}).
 */
export async function loadConfig(cwd: string = process.cwd()): Promise<RescreenConfig> {
  const dir = resolve(cwd);
  const jiti = createJiti(dir);

  for (const file of CONFIG_FILES) {
    const fullPath = join(dir, file);
    try {
      await access(fullPath);
    } catch (err) {
      if (isNotFound(err)) continue;
      throw err;
    }

    const mod: unknown = await jiti.import(fullPath);
    const exported = isRecord(mod) && "default" in mod ? mod.default : mod;
    return validateConfig(exported, file);
  }

  throw new ConfigError(
    `Не найден rescreen.config.ts в ${dir}. Создайте файл конфигурации (команда init появится в следующих тикетах).`,
  );
}

function validateConfig(raw: unknown, file: string): RescreenConfig {
  if (!isRecord(raw)) {
    throw new ConfigError(
      `${file}: конфиг должен экспортировать объект (export default defineConfig({...}))`,
    );
  }
  if (typeof raw.baseUrl !== "string" || raw.baseUrl.length === 0) {
    throw new ConfigError(`${file}: задайте непустой baseUrl — базовый URL сайта`);
  }
  if (!Array.isArray(raw.pages) || raw.pages.length === 0) {
    throw new ConfigError(`${file}: в конфиге нет ни одной Page — заполните поле pages`);
  }
  for (const page of raw.pages) {
    if (!isRecord(page) || typeof page.name !== "string" || page.name.length === 0) {
      throw new ConfigError(`${file}: каждая Page обязана иметь непустое поле name`);
    }
    if (typeof page.path !== "string" || page.path.length === 0) {
      throw new ConfigError(`${file}: Page "${page.name}" обязана иметь непустое поле path`);
    }
  }
  return raw as unknown as RescreenConfig;
}

/**
 * Применяет значения по умолчанию к конфигу.
 *
 * Предусловие: `config` валиден (см. инварианты в `./types.ts`).
 * Постусловие: в каждой ResolvedPageConfig viewport = page.viewport ?? config.viewport ?? DEFAULT_VIEWPORT,
 * threshold = page.threshold ?? config.threshold ?? DEFAULT_THRESHOLD; отсутствующие mask/elements — пустые списки.
 * Инвариант: не мутирует вход; порядок Page сохраняется. Слияние глобальных и
 * per-page Mask'ов здесь не выполняется — это обязанность Runner'а.
 */
export function resolveConfig(config: RescreenConfig): ResolvedConfig {
  const pages: ResolvedPageConfig[] = config.pages.map((page) => ({
    name: page.name,
    path: page.path,
    viewport: page.viewport ?? config.viewport ?? DEFAULT_VIEWPORT,
    mask: page.mask ?? [],
    threshold: page.threshold ?? config.threshold ?? DEFAULT_THRESHOLD,
    elements: page.elements ?? [],
  }));

  return {
    baseUrl: config.baseUrl,
    mask: config.mask ?? [],
    threshold: config.threshold ?? DEFAULT_THRESHOLD,
    pages,
  };
}
