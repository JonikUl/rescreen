import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import type { BaselineStorage } from "./types.js";
import type { Snapshot, SnapshotKey } from "../snapshot/types.js";
import type { RunResult } from "../runner/types.js";

/** Файловая реализация {@link BaselineStorage}. */
export type FileBaselineStorage = BaselineStorage & {
  /** Абсолютный путь к корню хранилища (например, `<cwd>/.rescreen`). */
  readonly rootDir: string;
};

interface SnapshotMeta {
  readonly capturedAt: string;
  readonly masksApplied: readonly string[];
}

/** Layout: `baselines/`, `current/`, `diffs/`, `last-run.json`, `audit.jsonl` под rootDir. */
export function createFileStorage(rootDir?: string): FileBaselineStorage {
  const root = resolve(rootDir ?? join(process.cwd(), ".rescreen"));
  const dirBaselines = join(root, "baselines");
  const dirCurrent = join(root, "current");
  const dirDiffs = join(root, "diffs");

  /**
   * Ключ → имя файла: `<page>__<width>x<height>[__<base64url(element)>].png`;
   * base64url без паддинга — селекторы со слешем, пробелами и юникодом кодируются без потерь.
   */
  const keyToFilename = (key: SnapshotKey): string => {
    const base = `${key.page}__${key.viewport.width}x${key.viewport.height}`;
    if (!key.element) return `${base}.png`;
    const encoded = Buffer.from(key.element, "utf8").toString("base64url");
    return `${base}__${encoded}.png`;
  };

  const readSnapshot = async (dir: string, key: SnapshotKey): Promise<Snapshot | null> => {
    const file = join(dir, keyToFilename(key));
    let png: Buffer;
    try {
      png = await readFile(file);
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }

    let capturedAt = new Date();
    let masksApplied: readonly string[] = [];
    try {
      const meta = JSON.parse(await readFile(metaPath(file), "utf8")) as SnapshotMeta;
      capturedAt = new Date(meta.capturedAt);
      masksApplied = meta.masksApplied;
    } catch (err) {
      if (!isNotFound(err)) throw err;
      // метаданных нет (Baseline положили вручную) — берём значения по умолчанию
    }
    return { key, png: new Uint8Array(png), capturedAt, masksApplied };
  };

  const saveSnapshot = async (dir: string, snapshot: Snapshot): Promise<void> => {
    await mkdir(dir, { recursive: true });
    const file = join(dir, keyToFilename(snapshot.key));
    await writeFile(file, Buffer.from(snapshot.png));
    const meta: SnapshotMeta = {
      capturedAt: snapshot.capturedAt.toISOString(),
      masksApplied: snapshot.masksApplied,
    };
    await writeFile(metaPath(file), JSON.stringify(meta));
  };

  return {
    rootDir: root,

    getBaseline(key) {
      return readSnapshot(dirBaselines, key);
    },

    async saveCurrent(snapshot) {
      await saveSnapshot(dirCurrent, snapshot);
    },

    async saveBaseline(snapshot) {
      await saveSnapshot(dirBaselines, snapshot);
    },

    async approve(key) {
      const current = await readSnapshot(dirCurrent, key);
      if (!current) {
        throw new Error(
          `Нельзя подтвердить ${describeKey(key)}: нет текущего снимка — сначала выполните run.`,
        );
      }
      const existing = await readSnapshot(dirBaselines, key);
      if (existing && Buffer.compare(Buffer.from(existing.png), Buffer.from(current.png)) === 0) {
        return existing; // идемпотентно: Baseline уже равен текущему снимку
      }
      await saveSnapshot(dirBaselines, current);
      const entry = {
        at: new Date().toISOString(),
        page: key.page,
        viewport: key.viewport,
        ...(key.element === undefined ? {} : { element: key.element }),
      };
      await mkdir(root, { recursive: true });
      await appendFile(join(root, "audit.jsonl"), `${JSON.stringify(entry)}\n`);
      return current;
    },

    async saveRunResult(result) {
      await mkdir(root, { recursive: true });
      const json = {
        startedAt: result.startedAt.toISOString(),
        results: result.results,
        summary: result.summary,
      };
      await writeFile(join(root, "last-run.json"), JSON.stringify(json, null, 2));
    },

    async getLastRunResult() {
      let raw: string;
      try {
        raw = await readFile(join(root, "last-run.json"), "utf8");
      } catch (err) {
        if (isNotFound(err)) return null;
        throw err;
      }
      const parsed = JSON.parse(raw) as { startedAt: string } & Omit<RunResult, "startedAt">;
      return { ...parsed, startedAt: new Date(parsed.startedAt) };
    },

    getCurrent(key) {
      return readSnapshot(dirCurrent, key);
    },

    async getDiff(key) {
      try {
        return new Uint8Array(await readFile(join(dirDiffs, keyToFilename(key))));
      } catch (err) {
        if (isNotFound(err)) return null;
        throw err;
      }
    },

    async saveDiff(key, png) {
      await mkdir(dirDiffs, { recursive: true });
      await writeFile(join(dirDiffs, keyToFilename(key)), Buffer.from(png));
    },
  };
}

function metaPath(pngPath: string): string {
  return `${pngPath.replace(/\.png$/, "")}.json`;
}

function isNotFound(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && err.code === "ENOENT";
}

function describeKey(key: SnapshotKey): string {
  const element = key.element === undefined ? "" : ` :: ${key.element}`;
  return `"${key.page}" (${key.viewport.width}×${key.viewport.height}${element})`;
}
