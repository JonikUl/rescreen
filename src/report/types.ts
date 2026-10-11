import type { RunResult } from "../runner/types.js";

/**
 * Reporter — превращает результат Run'а в один самодостаточный HTML-файл Report'а
 * на русском языке (изображения встроены, открывается без сервера).
 */
export interface Reporter {
  /**
   * Генерирует Report.
   *
   * Предусловие: `result` — результат завершённого Run'а; текущие Snapshot'ы,
   * Baseline'ы и Diff-изображения доступны через хранилище/реализацию.
   *
   * Постусловие: возвращает путь к HTML-файлу; файл самодостаточен
   * (не требует сервера и внешних ресурсов).
   * Инвариант: не изменяет Baseline'ы и Snapshot'ы.
   */
  render(result: RunResult): Promise<string>;
}
