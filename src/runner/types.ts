import type { SnapshotKey } from "../snapshot/types.js";

/**
 * Статус одного Snapshot'а в Run'е:
 * - `new-baseline` — Baseline'а не было, Snapshot стал Baseline'ом;
 * - `unchanged` — расхождение с Baseline'ом не превышает Threshold;
 * - `diff` — расхождение превышает Threshold;
 * - `skipped` — Snapshot не снят: запрошенный Element не найден на странице
 *   (нефатально; причина — в `warning`, на exit-код не влияет);
 * - `error` — Snapshot снять/сравнить не удалось (сеть, рендеринг, несовпадающие размеры).
 */
export type SnapshotStatus = "new-baseline" | "unchanged" | "diff" | "skipped" | "error";

/** Результат обработки одного Snapshot'а (страничного или элементного). */
export interface SnapshotResult {
  readonly key: SnapshotKey;
  readonly status: SnapshotStatus;
  /** Доля отличающихся пикселей; присутствует при статусе `diff` и `unchanged`. */
  readonly diffRatio?: number;
  /**
   * Нефатальное предупреждение: селектор Element'а не найден, стабильный кадр
   * не дождались за таймаут и т.п. При нескольких предупреждениях Snapshot'а
   * они склеены через "; ". При статусе `skipped` всегда заполнено (причина пропуска).
   */
  readonly warning?: string;
  /**
   * Mask'и, применённые при снятии (глобальные + per-page, в порядке применения);
   * на успешных снимках совпадает с `Snapshot.masksApplied`. При статусах `error`
   * и `skipped` — маски, запрошенные для цели (снимок не получен).
   */
  readonly masksApplied: readonly string[];
  /** Описание ошибки при статусе `error` (человекочитаемое, на русском). */
  readonly error?: string;
}

/**
 * Сводка Run'а.
 *
 * Инварианты:
 * - total = unchanged + diffs + newBaselines + skipped + errors;
 * - pages ≤ total (pages — число уникальных Page среди результатов;
 *   у Page с элементами снимков больше одного).
 */
export interface RunSummary {
  /**
   * Количество уникальных Page, участвовавших в прогоне (был хотя бы один
   * SnapshotResult). Учитываются все страницы прогона, в том числе те, где
   * все снимки завершились ошибкой или были пропущены, — «проверено» здесь
   * означает «обработано прогоном» (решение по story 8, тикет 05).
   */
  readonly pages: number;
  /** Общее число Snapshot'ов (страничных и элементных). */
  readonly total: number;
  readonly unchanged: number;
  readonly diffs: number;
  readonly newBaselines: number;
  /** Snapshot'ы, пропущенные из-за ненайденного Element'а (не влияют на exit-код). */
  readonly skipped: number;
  readonly errors: number;
}

/**
 * Результат одного Run'а.
 * Отображение на exit-коды (обязанность CLI): errors > 0 → 2; иначе diffs > 0 → 1;
 * иначе 0. Статус `skipped` на exit-код не влияет.
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
