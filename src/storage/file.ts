import { createHash } from "node:crypto";
import { appendFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import type { AuditEntry, BaselineStorage } from "./types.js";
import { snapshotKeyId } from "../snapshot/key.js";
import type { Snapshot, SnapshotKey } from "../snapshot/types.js";
import type { RunResult, SnapshotResult } from "../runner/types.js";

/** Файловая реализация {@link BaselineStorage}. */
export type FileBaselineStorage = BaselineStorage & {
  /** Абсолютный путь к корню хранилища (например, `<cwd>/.rescreen`). */
  readonly rootDir: string;
};

type SerializedSnapshotResult = Omit<SnapshotResult, "attemptedAt" | "capturedAt"> & {
  readonly attemptedAt: string;
  readonly capturedAt?: string;
};

function serializeSnapshotResult(result: SnapshotResult): SerializedSnapshotResult {
  const { attemptedAt, capturedAt, ...rest } = result;
  return {
    ...rest,
    attemptedAt: attemptedAt.toISOString(),
    ...(capturedAt === undefined ? {} : { capturedAt: capturedAt.toISOString() }),
  };
}

function deserializeSnapshotResult(result: SerializedSnapshotResult): SnapshotResult {
  const { attemptedAt, capturedAt, ...rest } = result;
  return {
    ...rest,
    attemptedAt: new Date(attemptedAt),
    ...(capturedAt === undefined ? {} : { capturedAt: new Date(capturedAt) }),
  };
}

async function readSnapshotStates(file: string): Promise<SnapshotResult[]> {
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch (err) {
    if (isNotFound(err)) return [];
    throw err;
  }
  const parsed = JSON.parse(raw) as SerializedSnapshotResult[];
  return parsed.map((result) => deserializeSnapshotResult(result));
}

interface SnapshotMeta {
  readonly capturedAt: string;
  readonly masksApplied: readonly string[];
  readonly warnings?: readonly string[];
}

/** Layout: `baselines/`, `current/`, `diffs/`, `last-run.json`, `audit.jsonl` под rootDir. */
export function createFileStorage(rootDir?: string): FileBaselineStorage {
  const root = resolve(rootDir ?? join(process.cwd(), ".rescreen"));
  const dirBaselines = join(root, "baselines");
  const dirCurrent = join(root, "current");
  const dirDiffs = join(root, "diffs");

  /**
   * Ключ → имя файла: `<page>__<width>x<height>[__<hex(element)>].png`;
   * hex — селекторы со слешем, пробелами и юникодом кодируются без потерь,
   * а кодировка не содержит `_` и `x`, поэтому имя файла однозначно
   * разбирается обратно ({@link filenameToKey}): `__<digits>x<digits>` может
   * встретиться только как разделитель viewport'а, а hex-суффикс не может
   * содержать разделитель `__`.
   */
  const keyToFilename = (key: SnapshotKey): string => {
    const base = `${key.page}__${key.viewport.width}x${key.viewport.height}`;
    if (!key.element) return `${base}.png`;
    const encoded = Buffer.from(key.element, "utf8").toString("hex");
    return `${base}__${encoded}.png`;
  };

  /**
   * Обратное разбиение имени файла в ключ (для {@link listUnapprovedDiffs}).
   * Page — жадно: slug может сам содержать `__` и даже `__<digits>x<digits>`.
   * Файлы, не подходящие под формат ключа (посторонние), возвращают null.
   */
  const filenameToKey = (filename: string): SnapshotKey | null => {
    const match = /^(.+)__(\d+)x(\d+)(?:__([0-9a-f]+))?\.png$/.exec(filename);
    if (!match) return null;
    const [, page, width, height, element] = match;
    const viewport = { width: Number(width), height: Number(height) };
    if (element === undefined) return { page: page!, viewport };
    return { page: page!, viewport, element: Buffer.from(element, "hex").toString("utf8") };
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
    let warnings: readonly string[] = [];
    try {
      const meta = JSON.parse(await readFile(metaPath(file), "utf8")) as SnapshotMeta;
      capturedAt = new Date(meta.capturedAt);
      masksApplied = meta.masksApplied;
      // sidecar'ы формата до ticket 03 warnings не содержат — читаем как []
      warnings = meta.warnings ?? [];
    } catch (err) {
      if (!isNotFound(err)) throw err;
      // метаданных нет (Baseline положили вручную) — берём значения по умолчанию
    }
    return { key, png: new Uint8Array(png), capturedAt, masksApplied, warnings };
  };

  const saveSnapshot = async (dir: string, snapshot: Snapshot): Promise<void> => {
    await mkdir(dir, { recursive: true });
    const file = join(dir, keyToFilename(snapshot.key));
    await writeFile(file, Buffer.from(snapshot.png));
    const meta: SnapshotMeta = {
      capturedAt: snapshot.capturedAt.toISOString(),
      masksApplied: snapshot.masksApplied,
      warnings: snapshot.warnings,
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
      const alreadyApproved =
        existing !== null &&
        Buffer.compare(Buffer.from(existing.png), Buffer.from(current.png)) === 0;
      if (!alreadyApproved) {
        await saveSnapshot(dirBaselines, current);
        const entry: AuditEntry = {
          at: new Date().toISOString(),
          page: key.page,
          viewport: key.viewport,
          ...(key.element === undefined ? {} : { element: key.element }),
          sha256: createHash("sha256").update(current.png).digest("hex"),
        };
        await mkdir(root, { recursive: true });
        await appendFile(join(root, "audit.jsonl"), `${JSON.stringify(entry)}\n`);
      }
      // Diff-файл удаляется на обеих ветках (ADR-0003): неподтверждённого Diff'а
      // по ключу больше нет, в том числе при идемпотентном approve
      await rm(join(dirDiffs, keyToFilename(key)), { force: true });

      const statePath = join(root, "state.json");
      const states = await readSnapshotStates(statePath);
      let stateChanged = false;
      const updated = states.map((state) => {
        if (snapshotKeyId(state.key) !== snapshotKeyId(key) || state.status !== "diff") {
          return state;
        }
        stateChanged = true;
        return { ...state, status: "unchanged" as const, diffRatio: 0 };
      });
      if (stateChanged) {
        await writeFile(statePath, JSON.stringify(updated.map(serializeSnapshotResult), null, 2));
      }
      return alreadyApproved && existing !== null ? existing : current;
    },

    async saveRunResult(result) {
      const statePath = join(root, "state.json");
      const states = new Map(
        (await readSnapshotStates(statePath)).map((state) => [snapshotKeyId(state.key), state]),
      );
      for (const state of result.results) {
        states.set(snapshotKeyId(state.key), state);
      }

      await mkdir(root, { recursive: true });
      const json = {
        startedAt: result.startedAt.toISOString(),
        results: result.results.map(serializeSnapshotResult),
        summary: result.summary,
      };
      await writeFile(join(root, "last-run.json"), JSON.stringify(json, null, 2));
      const merged = [...states.values()].sort((a, b) =>
        snapshotKeyId(a.key).localeCompare(snapshotKeyId(b.key)),
      );
      await writeFile(statePath, JSON.stringify(merged.map(serializeSnapshotResult), null, 2));
    },

    listSnapshotStates() {
      return readSnapshotStates(join(root, "state.json"));
    },

    async getLastRunResult() {
      let raw: string;
      try {
        raw = await readFile(join(root, "last-run.json"), "utf8");
      } catch (err) {
        if (isNotFound(err)) return null;
        throw err;
      }
      const parsed = JSON.parse(raw) as {
        startedAt: string;
        results: SerializedSnapshotResult[];
        summary: RunResult["summary"];
      };
      return {
        startedAt: new Date(parsed.startedAt),
        results: parsed.results.map(deserializeSnapshotResult),
        summary: parsed.summary,
      };
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

    async deleteDiff(key) {
      await rm(join(dirDiffs, keyToFilename(key)), { force: true });
    },

    async listUnapprovedDiffs() {
      let files: string[];
      try {
        files = await readdir(dirDiffs);
      } catch (err) {
        if (isNotFound(err)) return [];
        throw err;
      }
      return files
        .sort()
        .map(filenameToKey)
        .filter((k): k is SnapshotKey => k !== null);
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
