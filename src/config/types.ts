/**
 * Схема конфигурации `rescreen.config.ts` и её контракт.
 *
 * Инварианты валидного конфига (проверяются загрузчиком, см. ticket 08):
 * - `pages` непустой; `name` каждой Page уникален в пределах конфига;
 * - `baseUrl` — валидный http(s) URL;
 * - `path` каждой Page начинается с `/`;
 * - каждый CSS-селектор в `mask` и `elements` — непустая строка;
 * - `threshold` ∈ [0, 1] — доля отличающихся пикселей (0 — любое расхождение является Diff'ом);
 * - размеры viewport — положительные целые.
 */

/** Размер окна браузера в пикселях. */
export interface Viewport {
  readonly width: number;
  readonly height: number;
}

/** Viewport по умолчанию (desktop), применяется когда не переопределён. */
export const DEFAULT_VIEWPORT: Viewport = { width: 1440, height: 900 } as const;

/** Threshold по умолчанию: любое расхождение является Diff'ом. */
export const DEFAULT_THRESHOLD = 0 as const;

/** Page — конкретная страница сайта, за которой следит инструмент. */
export interface PageConfig {
  /** Уникальное имя Page; используется в CLI (`run home`), ключах хранилища и Report'е. */
  readonly name: string;
  /** Путь относительно `baseUrl`, начинается с `/`. */
  readonly path: string;
  /** Переопределение viewport для этой Page. */
  readonly viewport?: Viewport;
  /** Per-page Mask'и (CSS-селекторы); применяются в дополнение к глобальным. */
  readonly mask?: readonly string[];
  /** Переопределение Threshold для этой Page, ∈ [0, 1]. */
  readonly threshold?: number;
  /** Element'ы (CSS-селекторы), снимаемые собственными Snapshot'ами. */
  readonly elements?: readonly string[];
}

/** Корневой конфиг `rescreen.config.ts`. */
export interface RescreenConfig {
  /** Базовый URL сайта; полный URL Page = `baseUrl` + `path`. */
  readonly baseUrl: string;
  /** Viewport по умолчанию для всех Page; если не задан — {@link DEFAULT_VIEWPORT}. */
  readonly viewport?: Viewport;
  /** Глобальные Mask'и (CSS-селекторы), применяемые на всех Page. */
  readonly mask?: readonly string[];
  /** Threshold по умолчанию для всех Page; если не задан — {@link DEFAULT_THRESHOLD}. */
  readonly threshold?: number;
  /** Список Page, непустой. */
  readonly pages: readonly PageConfig[];
}

/** PageConfig с применёнными значениями по умолчанию: все опциональные поля resolved. */
export interface ResolvedPageConfig {
  readonly name: string;
  readonly path: string;
  readonly viewport: Viewport;
  readonly mask: readonly string[];
  readonly threshold: number;
  readonly elements: readonly string[];
}

/** RescreenConfig с применёнными значениями по умолчанию. */
export interface ResolvedConfig {
  readonly baseUrl: string;
  /** Глобальные Mask'и (без per-page; слияние — обязанность Runner'а). */
  readonly mask: readonly string[];
  readonly threshold: number;
  readonly pages: readonly ResolvedPageConfig[];
}

/**
 * Типизирующий хелпер для `rescreen.config.ts`: возвращает аргумент как есть.
 * Существует ради автодополнения и проверки типов в IDE; валидация — отдельно.
 */
export function defineConfig(config: RescreenConfig): RescreenConfig {
  return config;
}

/**
 * Применяет значения по умолчанию к конфигу.
 *
 * Предусловие: `config` валиден (см. инварианты выше).
 * Постусловие: в каждой ResolvedPageConfig viewport = page.viewport ?? config.viewport ?? DEFAULT_VIEWPORT,
 * threshold = page.threshold ?? config.threshold ?? DEFAULT_THRESHOLD; отсутствующие mask/elements — пустые списки.
 * Инвариант: не мутирует вход; порядок Page сохраняется.
 */
export declare function resolveConfig(config: RescreenConfig): ResolvedConfig;

/** Ошибка загрузки или валидации конфига. `message` — человекочитаемый, на русском. */
export class ConfigError extends Error {
  override readonly name = "ConfigError";
}

/**
 * Загружает и валидирует конфиг из `rescreen.config.ts`.
 *
 * Постусловие: возвращённый конфиг удовлетворяет всем инвариантам схемы.
 * Ошибки: бросает {@link ConfigError} с понятным сообщением (нет pages, битый URL,
 * пустой селектор, threshold вне [0, 1], дублирующееся name) — до старта любого Run.
 */
export declare function loadConfig(cwd?: string): Promise<RescreenConfig>;
