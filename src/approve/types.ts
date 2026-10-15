import type { Snapshot } from "../snapshot/types.js";

/** Результат сценария Approve. */
export interface ApproveResult {
  /**
   * Snapshot'ы, ставшие Baseline'ами в ходе этого Approve, в порядке листинга
   * хранилища. Пустой список — «нечего аппрувить» (не ошибка).
   */
  readonly approved: readonly Snapshot[];
}

/**
 * Approver — сценарий команды `rescreen approve`: подтверждение неподтверждённых
 * Diff'ов как ожидаемых (spec, stories 22–26). Работает только через BaselineStorage:
 * текущий Snapshot каждого неподтверждённого Diff'а становится новым Baseline'ом
 * ({@link BaselineStorage.approve}), каждый Approve пишет запись в Audit Log.
 *
 * Неподтверждённый Diff — ключ, по которому в хранилище лежит Diff-файл (ADR-0003).
 * Список кандидатов берётся из {@link BaselineStorage.listUnapprovedDiffs}: Approve
 * не читает ни результат последнего Run'а, ни конфиг, поэтому переживает filtered
 * run («переснял одну Page до Approve другой» — штатный сценарий) и аппрувит
 * Diff'ы Page, удалённых из конфига.
 */
export interface Approver {
  /**
   * Подтверждает неподтверждённые Diff'ы.
   *
   * Без `pageNames` — все неподтверждённые Diff'ы; с `pageNames` — только Diff'ы
   * указанных Page, включая их элементные Snapshot'ы; Diff'ы остальных Page
   * остаются неподтверждёнными. Имя без неподтверждённых Diff'ов (в том числе
   * опечатка) не является ошибкой — выбор фильтром сужает, но не создаёт Diff'ов.
   *
   * Предусловий нет: при отсутствии неподтверждённых Diff'ов возвращает пустой
   * список.
   *
   * Постусловие: для каждого возвращённого Snapshot'а Baseline побайтово равен
   * текущему Snapshot'у, Diff-файл по его ключу удалён; Audit Log пополнился
   * ровно одной записью на каждый возвращённый Snapshot.
   *
   * Инвариант: идемпотентно — повторный approve без нового Run'а возвращает пустой
   * список и не пишет в Audit Log.
   */
  approve(pageNames?: readonly string[]): Promise<ApproveResult>;
}
