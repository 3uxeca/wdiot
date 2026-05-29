/**
 * Capture layer — public surface (plan Work Unit B).
 *
 * Work Unit F wires `CaptureScheduler` into `main/index.ts` and reads the
 * `HealthRegistry` (+ Korean tray strings) for the tray. The capture layer
 * never imports the tray or `main/index.ts` itself.
 */
export { CaptureScheduler } from './scheduler.js';
export type { SchedulerOptions } from './scheduler.js';
export {
  DEFAULT_APP_INTERVAL_MS,
  DEFAULT_BROWSER_INTERVAL_MS,
} from './scheduler.js';

export {
  HealthRegistry,
  SourceHealthMachine,
  CAPTURE_SOURCE_IDS,
  DENIED_ESCALATION_THRESHOLD,
  trayStatusString,
  trayStatusStrings,
  settingsLinkForSource,
  permissionKindForSource,
} from './health.js';
export type {
  CaptureSourceId,
  HealthState,
  SourceHealth,
  HealthChangeEvent,
  PollOutcome,
  PermissionKind,
} from './health.js';

export { parseSearchQuery, pollBrowser } from './browser-source.js';
export type { BrowserTab, ParsedSearch, BrowserPollResult } from './browser-source.js';

export { readActiveApp, AppSwitchDetector } from './app-source.js';
export type { ActiveApp } from './app-source.js';

export { runOsascript, OsascriptError, OSASCRIPT_TIMEOUT_MS } from './applescript.js';
export type { OsascriptFailureKind } from './applescript.js';
