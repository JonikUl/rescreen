import type { Snapshot, SnapshotKey } from "../snapshot/types.js";
import type { RunResult } from "../runner/types.js";
import type { Viewport } from "../config/types.js";

/**
 * Запись Audit Log'а (JSONL, одна строка на Approve одного Snapshot'а).
 *
 * Формат зафиксирован (spec, story 25 — «что, когда, какой Snapshot стал Baseline'ом»):
 * - `at` — момент Approve (ISO 8601, UTC);
 * - `page`, `viewport`, `element?` — ключ Snapshot'а (`element` присутствует только
 *   у элементных Snapshot'ов);
 * - `sha256` — hex-хеш содержимого PNG, ставшего Baseline'ом: идентичность Snapshot'а,
 *   по которой запись можно сопоставить с файлом в `baselines/`.
 *
 * Инвариант: записи только добавляются (append-only), одна операция Approve одного
 * Snapshot'а — ровно одна запись.
 */
export interface AuditEntry {
  readonly at: string;
  readonly page: string;
  readonly viewport: Viewport;
  readonly element?: string;
  readonly sha256: string;
}

/**
 * BaselineStorage — хранилище Snapshot'ов и результатов Run'ов.
 * Файловая реализация: всё под `.rescreen/`. Интерфейс — задел под git/S3 (ADR-0001, spec).
 *
 * Инварианты реализации:
 * - round-trip: Snapshot, сохранённый по ключу, читается обратно с побайтово тем же `png`,
 *   тем же ключом (по компонентам) и теми же метаданными (`masksApplied`, `warnings`,
 *   `capturedAt` — через sidecar-файл рядом с PNG) — для любых допустимых компонентов
 *   ключа, включая селекторы с `/`, пробелами и юникодом (проверяется property-based тестами);
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
   * в Audit Log (JSONL) добавляется запись {@link AuditEntry}
   * (что, когда, sha256 Snapshot'а, ставшего Baseline'ом).
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
   * Возвращает текущий Snapshot последнего Run'а по ключу или null.
   * Инвариант: чистое чтение — не создаёт и не изменяет данные.
   */
  getCurrent(key: SnapshotKey): Promise<Snapshot | null>;

  /**
   * Возвращает Diff-изображение последнего Run'а по ключу или null.
   * Инвариант: чистое чтение.
   */
  getDiff(key: SnapshotKey): Promise<Uint8Array | null>;

  /**
   * Сохраняет Diff-изображение по ключу (вызывает Runner при обнаружении Diff'а).
   * Постусловие: `getDiff(key)` возвращает эти байты.
   * Инвариант: не изменяет ни Baseline, ни текущий Snapshot.
   */
  saveDiff(key: SnapshotKey, png: Uint8Array): Promise<void>;

  /**
   * Возвращает результат последнего Run'а или null, если Run'ов ещё не было.
   */
  getLastRunResult(): Promise<RunResult | null>;
}
