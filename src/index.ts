export { DEFAULT_THRESHOLD, DEFAULT_VIEWPORT, ConfigError, defineConfig } from "./config/types.js";
export type {
  PageConfig,
  RescreenConfig,
  ResolvedConfig,
  ResolvedPageConfig,
  Viewport,
} from "./config/types.js";
export { loadConfig, resolveConfig } from "./config/loader.js";
export type { Snapshot, SnapshotKey } from "./snapshot/types.js";
export { ElementNotFoundError } from "./capture/types.js";
export type { Capture, CaptureTarget } from "./capture/types.js";
export {
  createPlaywrightCapture,
  FRAME_STABILITY_INTERVAL_MS,
  FRAME_STABILITY_PROBES,
  FRAME_STABILITY_TIMEOUT_MS,
} from "./capture/playwright.js";
export { DimensionMismatchError } from "./diff/types.js";
export type { DiffEngine, DiffResult } from "./diff/types.js";
export { createPixelmatchDiffEngine } from "./diff/pixelmatch.js";
export type { AuditEntry, BaselineStorage } from "./storage/types.js";
export { createFileStorage } from "./storage/file.js";
export type { FileBaselineStorage } from "./storage/file.js";
export type { Approver, ApproveResult } from "./approve/types.js";
export { createApprover } from "./approve/approve.js";
export type { ApproverDeps } from "./approve/approve.js";
export type {
  Runner,
  RunResult,
  RunSummary,
  SnapshotResult,
  SnapshotStatus,
} from "./runner/types.js";
export { createRunner } from "./runner/runner.js";
export type { RunnerDeps } from "./runner/runner.js";
export { toExitCode } from "./runner/exit-code.js";
export type { Reporter } from "./report/types.js";
export { createHtmlReporter } from "./report/html.js";
export type { HtmlReporterDeps } from "./report/html.js";
export { openReport, reportPathFor } from "./report/open.js";
export type { OpenReportDeps, OpenReportResult } from "./report/open.js";
export { formatSummaryLine, pluralize } from "./text/plural.js";
