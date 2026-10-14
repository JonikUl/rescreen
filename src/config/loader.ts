import { access } from "node:fs/promises";
import { join, resolve } from "node:path";

import { createJiti } from "jiti";

import { ConfigError, DEFAULT_THRESHOLD, DEFAULT_VIEWPORT } from "./types.js";
import type { RescreenConfig, ResolvedConfig, ResolvedPageConfig } from "./types.js";

const CONFIG_FILES = ["rescreen.config.ts", "rescreen.config.js", "rescreen.config.mjs"] as const;

export { CONFIG_FILES };

/** Slug-алфавит имени Page — предусловие {@link SnapshotKey}: имя попадает в имя файла хранилища без экранирования. */
const PAGE_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNotFound(err: unknown): boolean {
  return isRecord(err) && err.code === "ENOENT";
}

/**
 * Загружает конфиг из `rescreen.config.ts` (расширения .js/.mjs — fallback).
 *
 * Постусловие: возвращённый конфиг удовлетворяет всем инвариантам схемы
 * (см. `./types.ts`), проверяемым {@link validateConfig}.
 *
 * Ошибки: {@link ConfigError} с человекочитаемым сообщением на русском,
 * если файл не найден или инвариант нарушен — до старта любого Run.
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
    `Не найден rescreen.config.ts в ${dir}. Создайте конфигурацию командой: rescreen init`,
  );
}

/**
 * Валидирует уже загруженный конфиг против инвариантов схемы (см. `./types.ts`).
 *
 * Постусловие: возвращённый конфиг удовлетворяет всем инвариантам схемы.
 * Ошибки: {@link ConfigError} с человекочитаемым сообщением на русском при первом
 * же нарушении; никогда не бросает других типов ошибок, какой бы мусор ни был во входе.
 */
export function validateConfig(raw: unknown, file: string): RescreenConfig {
  if (!isRecord(raw)) {
    throw new ConfigError(
      `${file}: конфиг должен экспортировать объект (export default defineConfig({...}))`,
    );
  }
  if (typeof raw.baseUrl !== "string" || raw.baseUrl.length === 0) {
    throw new ConfigError(`${file}: задайте непустой baseUrl — базовый URL сайта`);
  }
  let parsedBaseUrl: URL;
  try {
    parsedBaseUrl = new URL(raw.baseUrl);
  } catch {
    throw new ConfigError(
      `${file}: baseUrl должен быть корректным URL сайта, получено: ${show(raw.baseUrl)}`,
    );
  }
  if (parsedBaseUrl.protocol !== "http:" && parsedBaseUrl.protocol !== "https:") {
    throw new ConfigError(
      `${file}: baseUrl должен начинаться с http:// или https://, получено: ${show(raw.baseUrl)}`,
    );
  }
  if (!Array.isArray(raw.pages) || raw.pages.length === 0) {
    throw new ConfigError(`${file}: в конфиге нет ни одной Page — заполните поле pages`);
  }
  validateSelectors(raw.mask, "mask", file);
  validateThreshold(raw.threshold, file);
  validateViewport(raw.viewport, file);
  const seenNames = new Set<string>();
  for (const page of raw.pages) {
    if (!isRecord(page) || typeof page.name !== "string" || page.name.length === 0) {
      throw new ConfigError(`${file}: каждая Page обязана иметь непустое поле name`);
    }
    if (!PAGE_NAME_PATTERN.test(page.name)) {
      throw new ConfigError(
        `${file}: имя Page ${JSON.stringify(page.name)} содержит недопустимые символы — разрешены только a-zA-Z0-9, "-" и "_" (имя попадает в имя файла хранилища)`,
      );
    }
    if (seenNames.has(page.name)) {
      throw new ConfigError(
        `${file}: имя Page "${page.name}" встречается дважды — имена Page должны быть уникальны`,
      );
    }
    seenNames.add(page.name);
    if (typeof page.path !== "string" || page.path.length === 0) {
      throw new ConfigError(`${file}: Page "${page.name}" обязана иметь непустое поле path`);
    }
    if (!page.path.startsWith("/")) {
      throw new ConfigError(
        `${file}: Page "${page.name}": path должен начинаться с "/", получено: ${JSON.stringify(page.path)}`,
      );
    }
    validateSelectors(page.mask, "mask", file, page.name);
    validateSelectors(page.elements, "elements", file, page.name);
    validateThreshold(page.threshold, file, page.name);
    validateViewport(page.viewport, file, page.name);
  }
  return raw as unknown as RescreenConfig;
}

function validateViewport(value: unknown, file: string, pageName?: string): void {
  if (value === undefined) return;
  const valid =
    isRecord(value) &&
    Number.isInteger(value.width) &&
    Number.isInteger(value.height) &&
    (value.width as number) > 0 &&
    (value.height as number) > 0;
  if (!valid) {
    throw new ConfigError(
      `${file}: ${at(pageName)}viewport должен быть объектом { width, height } с положительными целыми размерами, получено: ${show(value)}`,
    );
  }
}

function validateThreshold(value: unknown, file: string, pageName?: string): void {
  if (value === undefined) return;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new ConfigError(
      `${file}: ${at(pageName)}threshold должен быть числом от 0 до 1 (доля отличающихся пикселей), получено: ${show(value)}`,
    );
  }
}

/** Префикс контекста ошибки: `Page "home": ` для per-page полей, пусто для глобальных. */
function at(pageName?: string): string {
  return pageName === undefined ? "" : `Page "${pageName}": `;
}

/** Человекочитаемое представление значения для сообщения об ошибке; не падает на bigint/symbol/циклах. */
function show(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function validateSelectors(value: unknown, field: string, file: string, pageName?: string): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    throw new ConfigError(`${file}: ${at(pageName)}${field} должен быть массивом CSS-селекторов`);
  }
  for (const selector of value) {
    if (typeof selector !== "string" || selector.trim().length === 0) {
      throw new ConfigError(
        `${file}: ${at(pageName)}${field} содержит пустой селектор — селекторы должны быть непустыми строками`,
      );
    }
  }
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
