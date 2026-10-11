import type { Snapshot, SnapshotKey } from "../snapshot/types.js";
import type { RunResult } from "../runner/types.js";

/**
 * BaselineStorage — хранилище Snapshot'ов и результатов Run'ов.
 * Файловая реализация: всё под `.rescreen/`. Интерфейс — задел под git/S3 (ADR-0001, spec).
 *
 * Инварианты реализации:
 * - round-trip: Snapshot, сохранённый по ключу, читается обратно с побайтово тем же `png`
 *   и тем же ключом (по компонентам) — для любых допустимых компонентов ключа,
 *   включая селекторы с `/`, пробелами и юникодом (проверяется property-based тестами);
 * - Baseline и текущий Snapshot одного ключа хранятся независимо: запись текущего
 *   Snapshot'а не изменяет Baseline и наоборот (кроме {@link approve}).
 */
export interface BaselineStorage {
  /**
   * Возвращает Baseline по ключу или null, если Baseline ещё не создан.
   * Инвариант: чистое чтение — не создаёт и не изменяет данные.
   */
  getBaseline(key: SnapshotKey): Promise<Snapshot | null>;

  /**
   * Сохраняет Snapshot как текущий результат последнего Run'а по его ключу.
   * Постусловие: последующий {@link approve} по этому ключу может сослаться на этот Snapshot.
   * Инвариант: не изменяет Baseline.
   */
  saveCurrent(snapshot: Snapshot): Promise<void>;

  /**
   * Сохраняет Snapshot как Baseline по его ключу (создание Baseline при первом Run'е).
   * Постусловие: `getBaseline(key)` возвращает этот Snapshot.
   */
  saveBaseline(snapshot: Snapshot): Promise<void>;

  /**
   * Approve: текущий Snapshot по ключу становится новым Baseline'ом,
   * в Audit Log (JSONL) добавляется запись (что, когда, какой Snapshot → Baseline).
   *
   * Предусловие: по ключу существует текущий Snapshot (был Run).
   * Постусловие: `getBaseline(key)` побайтово равен текущему Snapshot'у на момент вызова;
   * Audit Log пополнился ровно одной записью.
   * Инвариант: идемпотентно — повторный approve без нового Run'а не меняет Baseline
   * и не добавляет записей.
   *
   * Ошибки: бросает ошибку, если текущего Snapshot'а по ключу нет.
   */
  approve(key: SnapshotKey): Promise<Snapshot>;

  /**
   * Сохраняет результат Run'а как последний (для команды `approve` и Report'а).
   * Инвариант: хранится только последний результат; история Run'ов не ведётся (spec: Out of Scope).
   */
  saveRunResult(result: RunResult): Promise<void>;

  /**
   * Возвращает результат последнего Run'а или null, если Run'ов ещё не было.
   */
  getLastRunResult(): Promise<RunResult | null>;
}
