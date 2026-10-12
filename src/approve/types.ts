import type { Snapshot } from "../snapshot/types.js";

/** Результат сценария Approve. */
export interface ApproveResult {
  /**
   * Snapshot'ы, ставшие Baseline'ами в ходе этого Approve, в порядке результатов
   * последнего Run'а. Пустой список — «нечего аппрувить» (не ошибка).
   */
  readonly approved: readonly Snapshot[];
}

/**
 * Approver — сценарий команды `rescreen approve`: подтверждение Diff'ов последнего
 * Run'а как ожидаемых (spec, stories 22–26). Работает только через BaselineStorage:
 * текущий Snapshot каждого неподтверждённого Diff'а становится новым Baseline'ом
 * ({@link BaselineStorage.approve}), каждый Approve пишет запись в Audit Log.
 *
 * Неподтверждённый Diff — SnapshotResult последнего Run'а со статусом `diff`,
 * текущий Snapshot которого всё ещё отличается от Baseline'а (побайтово). Diff,
 * подтверждённый прошлым Approve, неподтверждённым не считается.
 */
export interface Approver {
  /**
   * Подтверждает неподтверждённые Diff'ы последнего Run'а.
   *
   * Без `pageNames` — все неподтверждённые Diff'ы; с `pageNames` — только Diff'ы
   * указанных Page, включая их элементные Snapshot'ы; Diff'ы остальных Page
   * остаются неподтверждёнными.
   *
   * Предусловий нет: до первого Run'а или при отсутствии неподтверждённых Diff'ов
   * возвращает пустой список (выбор фильтром Page сужает, но не создаёт Diff'ов).
   *
   * Постусловие: для каждого возвращённого Snapshot'а Baseline побайтово равен
   * текущему Snapshot'у последнего Run'а; Audit Log пополнился ровно одной записью
   * на каждый возвращённый Snapshot.
   *
   * Инвариант: идемпотентно — повторный approve без нового Run'а возвращает пустой
   * список и не пишет в Audit Log.
   *
   * Ошибки: бросает ошибку, если в `pageNames` есть имя, которого нет в результатах
   * последнего Run'а; до первого Run'а любое непустое `pageNames` — ошибка
   * (проверить имена негде).
   */
  approve(pageNames?: readonly string[]): Promise<ApproveResult>;
}
