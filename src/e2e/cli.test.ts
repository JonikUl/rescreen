import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { afterEach, beforeAll, describe, expect, it } from "vite-plus/test";

import type { RunResult } from "../runner/types.js";
import type { SnapshotKey } from "../snapshot/types.js";
import { createFileStorage } from "../storage/file.js";
import { createPng, encodePng, makeSnapshot } from "../test-utils/png.js";

const execFileAsync = promisify(execFile);
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const cliPath = join(repoRoot, "dist", "cli.mjs");

interface CliOutcome {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Запускает собранный CLI подпроцессом; ненулевой exit-код — не исключение. */
async function runCli(cwd: string, args: readonly string[]): Promise<CliOutcome> {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [cliPath, ...args], { cwd });
    return { code: 0, stdout, stderr };
  } catch (err) {
    const failed = err as { code?: number; stdout?: string; stderr?: string };
    return {
      code: failed.code ?? -1,
      stdout: failed.stdout ?? "",
      stderr: failed.stderr ?? "",
    };
  }
}

describe("собранный CLI (end-to-end, без браузера)", () => {
  let dir: string;
  let cleanup: string;

  beforeAll(async () => {
    await execFileAsync("pnpm", ["build"], { cwd: repoRoot });
  }, 60_000);

  afterEach(async () => {
    await rm(cleanup, { recursive: true, force: true });
  });

  it("init создаёт конфиг с примером и директорию хранилища", async () => {
    dir = await mkdtemp(join(tmpdir(), "rescreen-e2e-init-"));
    cleanup = dir;

    const result = await runCli(dir, ["init"]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("создан rescreen.config.ts");
    expect(result.stdout).toContain("директория хранилища");

    const repeat = await runCli(dir, ["init"]);
    expect(repeat.code).toBe(0);
    expect(repeat.stdout).toContain("конфиг уже существует");
  });

  it("status группирует доску по Page; approve и prune работают с хранилищем", async () => {
    dir = await mkdtemp(join(tmpdir(), "rescreen-e2e-board-"));
    cleanup = dir;
    await writeFile(
      join(dir, "rescreen.config.ts"),
      `import { defineConfig } from ${JSON.stringify(join(repoRoot, "dist", "index.mjs"))};
export default defineConfig({
  baseUrl: "http://127.0.0.1:9",
  pages: [
    { name: "home", path: "/", elements: ["header"] },
    { name: "news", path: "/news" },
  ],
});
`,
    );

    // Засеваем хранилище напрямую: Diff по home, без изменений по элементу,
    // сирота "removed" (удалённая из конфига Page); news ни разу не снималась
    const storage = createFileStorage(join(dir, ".rescreen"));
    const homeKey: SnapshotKey = { page: "home", viewport: { width: 1440, height: 900 } };
    const headerKey: SnapshotKey = { ...homeKey, element: "header" };
    const removedKey: SnapshotKey = { page: "removed", viewport: { width: 1440, height: 900 } };
    const png = encodePng(createPng(2, 2));
    await storage.saveCurrent(makeSnapshot(homeKey, png));
    await storage.saveDiff(homeKey, png);
    await storage.saveBaseline(makeSnapshot(removedKey, png));
    await storage.saveCurrent(makeSnapshot(removedKey, png));
    const seeded: RunResult = {
      startedAt: new Date("2026-10-11T10:00:00.000Z"),
      results: [
        {
          key: homeKey,
          status: "diff",
          attemptedAt: new Date("2026-10-11T10:00:01.000Z"),
          capturedAt: new Date("2026-10-11T10:00:02.000Z"),
          diffRatio: 0.2,
          masksApplied: [],
        },
        {
          key: headerKey,
          status: "unchanged",
          attemptedAt: new Date("2026-10-11T10:00:03.000Z"),
          capturedAt: new Date("2026-10-11T10:00:04.000Z"),
          diffRatio: 0,
          masksApplied: [],
        },
        {
          key: removedKey,
          status: "unchanged",
          attemptedAt: new Date("2026-10-11T10:00:05.000Z"),
          capturedAt: new Date("2026-10-11T10:00:06.000Z"),
          diffRatio: 0,
          masksApplied: [],
        },
      ],
      summary: {
        pages: 2,
        total: 3,
        unchanged: 2,
        diffs: 1,
        newBaselines: 0,
        skipped: 0,
        errors: 0,
      },
    };
    await storage.saveRunResult(seeded);

    const board = await runCli(dir, ["status"]);
    expect(board.code).toBe(0);
    expect(board.stdout.indexOf("  home\n")).toBeLessThan(
      board.stdout.indexOf("(1440×900) — есть Diff (20.00% пикселей)"),
    );
    expect(board.stdout).toContain("(1440×900 :: header) — без изменений");
    expect(board.stdout).toContain("Снято: 2026-10-11T10:00:02.000Z");
    expect(board.stdout).toContain("  news\n    (1440×900) — нет данных");
    expect(board.stdout).not.toContain("removed");

    const approved = await runCli(dir, ["approve"]);
    expect(approved.code).toBe(0);
    expect(approved.stdout).toContain("подтверждено снимков: 1");

    const afterApprove = await runCli(dir, ["status"]);
    expect(afterApprove.code).toBe(0);
    expect(afterApprove.stdout).toContain("(1440×900) — без изменений");
    expect(afterApprove.stdout).not.toContain("есть Diff");

    const dryRun = await runCli(dir, ["prune", "--dry-run"]);
    expect(dryRun.code).toBe(0);
    expect(dryRun.stdout).toContain("предпросмотр");
    expect(dryRun.stdout).toContain("removed (1440×900)");
    expect(await storage.getBaseline(removedKey)).not.toBeNull();

    const pruned = await runCli(dir, ["prune"]);
    expect(pruned.code).toBe(0);
    expect(pruned.stdout).toContain("removed (1440×900)");
    expect(await storage.getBaseline(removedKey)).toBeNull();
    // last-run.json prune не трогает (решение тикета 10)
    expect((await storage.getLastRunResult())?.results).toHaveLength(3);

    const final = await runCli(dir, ["status"]);
    expect(final.code).toBe(0);
    expect(final.stdout).not.toContain("removed");
  });

  it("status с битым конфигом завершается с exit 2 и понятной ошибкой", async () => {
    dir = await mkdtemp(join(tmpdir(), "rescreen-e2e-broken-"));
    cleanup = dir;
    await writeFile(join(dir, "rescreen.config.ts"), `export default { pages: [] };\n`);

    const result = await runCli(dir, ["status"]);

    expect(result.code).toBe(2);
    expect(result.stderr).toContain("Ошибка конфигурации");
  });
});
