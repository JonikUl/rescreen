export { DEFAULT_THRESHOLD, DEFAULT_VIEWPORT, ConfigError, defineConfig } from "./config/types.js";
export type {
  PageConfig,
  RescreenConfig,
  ResolvedConfig,
  ResolvedPageConfig,
  Viewport,
} from "./config/types.js";
export type { Snapshot, SnapshotKey } from "./snapshot/types.js";
export { ElementNotFoundError } from "./capture/types.js";
export type { Capture, CaptureTarget } from "./capture/types.js";
export { DimensionMismatchError } from "./diff/types.js";
export type { DiffEngine, DiffResult } from "./diff/types.js";
export type { BaselineStorage } from "./storage/types.js";
export type {
  Runner,
  RunResult,
  RunSummary,
  SnapshotResult,
  SnapshotStatus,
} from "./runner/types.js";
export type { Reporter } from "./report/types.js";
