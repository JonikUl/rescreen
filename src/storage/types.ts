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
 *   Snapshot'а не изменяет Baseline и наоборот (кроме {@link approve});
 * - ADR-0003: Diff-файл по ключу лежит в хранилище ⟺ по этому ключу есть
 *   неподтверждённый Diff. Поддерживается совместно с Runner'ом: Run удаляет
 *   Diff-файл при статусе `unchanged` ({@link deleteDiff}), {@link approve} — при
 *   подтверждении. Diff-файл переживает filtered run — неподтверждённость не
 *   привязана к последнему Run'у.
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
   * Audit Log пополнился ровно одной записью; Diff-файл по ключу удалён
   * (`getDiff(key)` возвращает null) — неподтверждённого Diff'а по ключу больше нет
   * (ADR-0003), в том числе на идемпотентной ветке.
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
   * По ADR-0003 сам факт наличия Diff-файла — маркер неподтверждённого Diff'а.
   * Постусловие: `getDiff(key)` возвращает эти байты; ключ присутствует в
   * {@link listUnapprovedDiffs}.
   * Инвариант: не изменяет ни Baseline, ни текущий Snapshot.
   */
  saveDiff(key: SnapshotKey, png: Uint8Array): Promise<void>;

  /**
   * Удаляет Diff-изображение по ключу (вызывает Runner при статусе `unchanged`
   * и {@link approve} при подтверждении — поддержание инварианта ADR-0003).
   * Постусловие: `getDiff(key)` возвращает null; ключа нет в {@link listUnapprovedDiffs}.
   * Инвариант: идемпотентно — удаление несуществующего Diff'а не является ошибкой.
   */
  deleteDiff(key: SnapshotKey): Promise<void>;

  /**
   * Возвращает ключи всех неподтверждённых Diff'ов — всех, для которых лежит
   * Diff-файл (ADR-0003), включая элементные Snapshot'ы и Diff'ы Page, которых
   * могло не быть в последнем Run'е (filtered run, удалённые из конфига Page).
   * Инвариант: чистое чтение; порядок ключей стабилен (отсортирован).
   */
  listUnapprovedDiffs(): Promise<readonly SnapshotKey[]>;

  /**
   * Возвращает результат последнего Run'а или null, если Run'ов ещё не было.
   */
  getLastRunResult(): Promise<RunResult | null>;
}
