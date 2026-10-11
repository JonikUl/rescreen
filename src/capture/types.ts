import type { Snapshot, SnapshotKey } from "../snapshot/types.js";

/**
 * Цель съёмки: всё, что нужно Capture для одного Snapshot'а.
 * Собирается Runner'ом из конфига (url = baseUrl + path, mask = глобальные + per-page).
 *
 * Инвариант: `url` — абсолютный http(s) URL; `mask` может быть пустым.
 */
export interface CaptureTarget {
  readonly key: SnapshotKey;
  readonly url: string;
  /** Mask'и (CSS-селекторы) в порядке применения: сначала глобальные, затем per-page. */
  readonly mask: readonly string[];
}

/**
 * Запрошенный Element (`key.element`) не найден на странице.
 * Runner обязан превращать эту ошибку в предупреждение, не прерывая Run.
 */
export class ElementNotFoundError extends Error {
  override readonly name = "ElementNotFoundError";

  constructor(
    readonly selector: string,
    readonly page: string,
  ) {
    super(`Element "${selector}" не найден на странице "${page}"`);
  }
}

/**
 * Capture — шов между конвейером и рендерингом.
 * Реализация — Playwright (headless Chromium); в тестах подменяется фейком с PNG-фикстурами.
 *
 * Вся стабилизация живёт в реализации и прозрачна для вызывающего:
 * network idle, отключение CSS-анимаций, маскирование, ожидание стабильного кадра.
 */
export interface Capture {
  /**
   * Снимает Snapshot цели.
   *
   * Предусловие: `target` удовлетворяет инвариантам {@link CaptureTarget};
   * если `target.key.element` задан — это Snapshot Element'а, иначе полностраничный.
   *
   * Постусловие: возвращённый Snapshot имеет `key`, равный `target.key`
   * (по компонентам), и `masksApplied`, равный `target.mask`.
   *
   * Ошибки:
   * - {@link ElementNotFoundError} — селектор `key.element` не найден на странице;
   * - любая ошибка рендеринга/сети — обычное исключение; Runner превращает её
   *   в результат со статусом `error`, не прерывая остальной Run.
   */
  capture(target: CaptureTarget): Promise<Snapshot>;

  /**
   * Освобождает ресурсы (браузер).
   * Инвариант: идемпотентно; после dispose любой capture бросает ошибку.
   */
  dispose(): Promise<void>;
}
