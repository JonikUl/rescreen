/**
 * Diff — результат сравнения Snapshot'а с его Baseline'ом.
 *
 * Инварианты:
 * - `totalPixels > 0`, `0 <= diffPixels <= totalPixels`;
 * - `ratio = diffPixels / totalPixels`, ∈ [0, 1];
 * - `diffPng === null` тогда и только тогда, когда `diffPixels === 0`.
 */
export interface DiffResult {
  /** Число отличающихся пикселей. */
  readonly diffPixels: number;
  /** Общее число пикселей в изображении. */
  readonly totalPixels: number;
  /** Доля отличающихся пикселей, ∈ [0, 1]; сравнивается с Threshold. */
  readonly ratio: number;
  /** Diff-изображение с подсветкой расхождений; null при идентичных изображениях. */
  readonly diffPng: Uint8Array | null;
}

/** Изображения имеют разные размеры и не могут сравниваться попиксельно. */
export class DimensionMismatchError extends Error {
  override readonly name = "DimensionMismatchError";
}

/**
 * DiffEngine — адаптер над движком попиксельного сравнения (первая реализация — pixelmatch).
 * Задел на замену нативным odiff без изменения ядра (ADR-0001).
 */
export interface DiffEngine {
  /**
   * Сравнивает два PNG попиксельно.
   *
   * Предусловие: оба аргумента — валидные PNG одинаковых размеров.
   *
   * Постусловие: результат удовлетворяет инвариантам {@link DiffResult};
   * идентичные изображения дают `ratio === 0` и `diffPng === null`.
   * Инвариант: чистая функция от содержимого изображений — повторный вызов
   * с теми же байтами даёт тот же `ratio`.
   *
   * Чувствительность движка максимальна и не настраивается: единственная
   * пользовательская ручка — Threshold из конфига (доля пикселей).
   * Попиксельные расхождения, порождённые антиалиасингом, движок может
   * не засчитывать (антифлейк).
   *
   * Ошибки: {@link DimensionMismatchError} при разных размерах изображений.
   */
  compare(baselinePng: Uint8Array, currentPng: Uint8Array): Promise<DiffResult>;
}
