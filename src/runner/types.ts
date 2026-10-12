import type { SnapshotKey } from "../snapshot/types.js";

/**
 * Статус одного Snapshot'а в Run'е:
 * - `new-baseline` — Baseline'а не было, Snapshot стал Baseline'ом;
 * - `unchanged` — расхождение с Baseline'ом не превышает Threshold;
 * - `diff` — расхождение превышает Threshold;
 * - `error` — Snapshot снять/сравнить не удалось (сеть, рендеринг, несовпадающие размеры).
 */
export type SnapshotStatus = "new-baseline" | "unchanged" | "diff" | "error";

/** Результат обработки одного Snapshot'а (страничного или элементного). */
export interface SnapshotResult {
  readonly key: SnapshotKey;
  readonly status: SnapshotStatus;
  /** Доля отличающихся пикселей; присутствует при статусе `diff` и `unchanged`. */
  readonly diffRatio?: number;
  /**
   * Нефатальное предупреждение: селектор Element'а не найден, стабильный кадр
   * не дождались за таймаут и т.п. При нескольких предупреждениях Snapshot'а
   * они склеены через "; ".
   */
  readonly warning?: string;
  /**
   * Mask'и, применённые при снятии (глобальные + per-page, в порядке применения);
   * на успешных снимках совпадает с `Snapshot.masksApplied`. При статусе `error`
   * — маски, запрошенные для цели (снимок не получен).
   */
  readonly masksApplied: readonly string[];
  /** Описание ошибки при статусе `error` (человекочитаемое, на русском). */
  readonly error?: string;
}

/** Сводка Run'а. Инвариант: total = unchanged + diffs + newBaselines + errors. */
export interface RunSummary {
  readonly total: number;
  readonly unchanged: number;
  readonly diffs: number;
  readonly newBaselines: number;
  readonly errors: number;
}

/**
 * Результат одного Run'а.
 * Отображение на exit-коды (обязанность CLI): errors > 0 → 2; иначе diffs > 0 → 1; иначе 0.
 */
export interface RunResult {
  readonly startedAt: Date;
  readonly results: readonly SnapshotResult[];
  readonly summary: RunSummary;
}

/**
 * Runner — оркестратор Run'а: для каждой Page → Capture → сравнение с Baseline'ом
 * (через DiffEngine, учёт Threshold) → сбор результатов → сохранение через BaselineStorage
 * → генерация Report'а через Reporter.
 */
export interface Runner {
  /**
   * Выполняет Run.
   *
   * Предусловие: конфиг загружен и валиден; если `pageNames` задан — каждое имя
   * присутствует в конфиге (иначе CLI завершается с exit 2 до вызова run).
   *
   * Постусловие: для каждой выбранной Page (и каждого её Element'а) в результате
   * ровно один SnapshotResult; Baseline'ы созданы для всех `new-baseline`; текущие
   * Snapshot'ы и RunResult сохранены; Report сгенерирован.
   *
   * Инвариант: ошибка одного Snapshot'а не прерывает остальные (статус `error`);
   * первый Run без Baseline'а создаёт Baseline автоматически.
   */
  run(pageNames?: readonly string[]): Promise<RunResult>;
}
