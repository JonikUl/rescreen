import type { Viewport } from "../config/types.js";

/**
 * Ключ Snapshot'а / Baseline'а — идентичность снимка в хранилище.
 *
 * Инварианты:
 * - `page` — имя Page из конфига (непустое);
 * - `element` отсутствует для полностраничного Snapshot'а и содержит CSS-селектор
 *   для Snapshot'а Element'а;
 * - два ключа равны тогда и только тогда, когда равны все компоненты
 *   (viewport сравнивается по width/height).
 *
 * Предусловие: `page` — slug из безопасных символов (буквы, цифры, `-`, `_`):
 * имя попадает в имя файла хранилища без экранирования. Проверка — глубокая
 * валидация конфига (ticket 08). `element` ограничений не имеет: кодируется
 * base64url (селекторы с `/`, пробелами и юникодом безопасны).
 */
export interface SnapshotKey {
  readonly page: string;
  readonly viewport: Viewport;
  readonly element?: string;
}

/**
 * Snapshot — скриншот одной Page (или одного Element'а), сделанный в ходе одного Run.
 *
 * Инвариант: `png` — валидное PNG-изображение; `masksApplied` — именно те Mask'и,
 * которые были применены при снятии (глобальные + per-page, в порядке применения);
 * `warnings` — нефатальные предупреждения, возникшие при снятии (например, стабильный
 * кадр не достигнут за таймаут), на русском языке; пустой список, если снятие прошло чисто.
 */
export interface Snapshot {
  readonly key: SnapshotKey;
  /** PNG-кодированное изображение. */
  readonly png: Uint8Array;
  readonly capturedAt: Date;
  readonly masksApplied: readonly string[];
  /**
   * Нефатальные предупреждения при снятии (стабильный кадр не достигнут за таймаут и т.п.).
   * Наличие предупреждений не отменяет Snapshot: используется последний снятый кадр.
   */
  readonly warnings: readonly string[];
}
