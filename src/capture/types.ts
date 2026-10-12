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
   * (по компонентам), `masksApplied`, равный `target.mask`, и `warnings` —
   * предупреждения, возникшие при снятии (пустой список, если снятие прошло чисто).
   *
   * Стабильный кадр: перед финальным скриншотом Capture ждёт N одинаковых подряд
   * кадров (побайтовое сравнение PNG) с интервалом между пробами и общим таймаутом
   * (константы `FRAME_STABILITY_*` из реализации). При таймауте используется последний
   * снятый кадр, а в `Snapshot.warnings` добавляется предупреждение — это не ошибка.
   *
   * Маскирование: Mask'и внедряются CSS-правилами (`visibility: hidden`), поэтому
   * селекторы без совпадений на странице не приводят к ошибке; `masksApplied` — ровно
   * те селекторы, что были внедрены.
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
