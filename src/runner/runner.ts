import { ElementNotFoundError } from "../capture/types.js";
import { DimensionMismatchError } from "../diff/types.js";
import { resolveConfig } from "../config/loader.js";
import type { Capture, CaptureTarget } from "../capture/types.js";
import type { RescreenConfig, ResolvedPageConfig } from "../config/types.js";
import type { DiffEngine } from "../diff/types.js";
import type { Reporter } from "../report/types.js";
import type { Snapshot } from "../snapshot/types.js";
import type { BaselineStorage } from "../storage/types.js";
import type { Runner, RunResult, SnapshotResult } from "./types.js";

export interface RunnerDeps {
  /** Загруженный конфиг (resolved-конфиг тоже подходит); значения по умолчанию применяются внутри. */
  readonly config: RescreenConfig;
  readonly capture: Capture;
  readonly diffEngine: DiffEngine;
  readonly storage: BaselineStorage;
  readonly reporter: Reporter;
}

/**
 * Оркестратор Run'а: для каждой Page (и каждого её Element'а) → Capture → сравнение
 * с Baseline'ом через DiffEngine (учёт Threshold) → статус. Ошибка одного Snapshot'а
 * не прерывает остальные. Первый Run без Baseline'а создаёт Baseline автоматически.
 */
export function createRunner(deps: RunnerDeps): Runner {
  return {
    async run(pageNames?: readonly string[]): Promise<RunResult> {
      const resolved = resolveConfig(deps.config);

      let pages = resolved.pages;
      if (pageNames !== undefined && pageNames.length > 0) {
        const unknown = pageNames.filter((name) => !resolved.pages.some((p) => p.name === name));
        if (unknown.length > 0) {
          throw new Error(`Неизвестные Page: ${unknown.join(", ")} — проверьте имена в конфиге`);
        }
        const wanted = new Set(pageNames);
        pages = resolved.pages.filter((p) => wanted.has(p.name));
      }

      const startedAt = new Date();
      const results: SnapshotResult[] = [];

      for (const page of pages) {
        const mask = [...resolved.mask, ...page.mask];
        const url = `${resolved.baseUrl}${page.path}`;
        const targets: CaptureTarget[] = [
          { key: { page: page.name, viewport: page.viewport }, url, mask },
          ...page.elements.map((selector): CaptureTarget => ({
            key: { page: page.name, viewport: page.viewport, element: selector },
            url,
            mask,
          })),
        ];
        for (const target of targets) {
          results.push(await processTarget(target, page));
        }
      }

      const count = (status: SnapshotResult["status"]) =>
        results.filter((r) => r.status === status).length;
      const runResult: RunResult = {
        startedAt,
        results,
        summary: {
          total: results.length,
          unchanged: count("unchanged"),
          diffs: count("diff"),
          newBaselines: count("new-baseline"),
          errors: count("error"),
        },
      };

      await deps.storage.saveRunResult(runResult);
      await deps.reporter.render(runResult);
      return runResult;
    },
  };

  async function processTarget(
    target: CaptureTarget,
    page: ResolvedPageConfig,
  ): Promise<SnapshotResult> {
    const key = target.key;
    try {
      const snapshot: Snapshot = await deps.capture.capture(target);
      await deps.storage.saveCurrent(snapshot);

      const warning = snapshot.warnings.length > 0 ? snapshot.warnings.join("; ") : undefined;
      const baseline = await deps.storage.getBaseline(key);
      if (!baseline) {
        await deps.storage.saveBaseline(snapshot);
        return { key, status: "new-baseline", masksApplied: snapshot.masksApplied, warning };
      }

      const diff = await deps.diffEngine.compare(baseline.png, snapshot.png);
      if (diff.ratio > page.threshold) {
        if (diff.diffPng !== null) await deps.storage.saveDiff(key, diff.diffPng);
        return {
          key,
          status: "diff",
          diffRatio: diff.ratio,
          masksApplied: snapshot.masksApplied,
          warning,
        };
      }
      return {
        key,
        status: "unchanged",
        diffRatio: diff.ratio,
        masksApplied: snapshot.masksApplied,
        warning,
      };
    } catch (err) {
      if (err instanceof DimensionMismatchError) {
        return {
          key,
          status: "error",
          masksApplied: target.mask,
          error: `${err.message} (доработка поведения — позже)`,
        };
      }
      if (err instanceof ElementNotFoundError) {
        return {
          key,
          status: "error",
          masksApplied: target.mask,
          warning: err.message,
          error: err.message,
        };
      }
      return {
        key,
        status: "error",
        masksApplied: target.mask,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
