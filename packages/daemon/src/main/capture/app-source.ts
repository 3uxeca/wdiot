/**
 * Active-app capture source — plan B2 ("app-source").
 *
 * Reads the frontmost application + its focused window title and emits an
 * `app_switch` Activity **edge-triggered**: a row is written only when the
 * active-app *identity* changes, not on every tick (keeps the timeline sparse
 * and meaningful, per plan B2).
 *
 * ## Capture mechanism — Open Question
 * The plan lists a native `active-win` / `node-mac-permissions` module as an
 * Open Question for richer NSWorkspace data. v1 **defaults to `osascript`**
 * (System Events) as the plan specifies: no native module, no native rebuild
 * step, no extra dependency. The `osascript` path requires macOS Accessibility
 * permission. If a native NSWorkspace module is adopted later, only
 * {@link readActiveApp} changes — the edge-trigger logic and the scheduler
 * contract stay identical.
 */
import { randomUUID } from 'node:crypto';
import type { AppSwitchActivity } from '@wdiot/shared';
import { runOsascript, OsascriptError } from './applescript.js';
import { ACTIVE_APP_SCRIPT, FIELD_SEPARATOR } from './scripts/index.js';

/** The frontmost application, as read from macOS. */
export interface ActiveApp {
  appName: string;
  bundleId?: string;
  windowTitle?: string;
}

/**
 * Read the current frontmost app via `osascript` (System Events).
 *
 * Rejects with an {@link OsascriptError} on timeout / permission denial /
 * error so the caller (the scheduler) can route the failure to the health
 * state machine.
 */
export async function readActiveApp(signal?: AbortSignal): Promise<ActiveApp> {
  const raw = await runOsascript(ACTIVE_APP_SCRIPT, { signal });
  const parts = raw.split(FIELD_SEPARATOR);
  const appName = (parts[0] ?? '').trim();
  const bundleId = (parts[1] ?? '').trim();
  const windowTitle = (parts[2] ?? '').trim();

  if (appName.length === 0) {
    // A blank app name is not actionable — treat as a transient script error.
    throw new OsascriptError('error', 'active-app script returned no app name', null, '');
  }

  const app: ActiveApp = { appName };
  if (bundleId.length > 0) app.bundleId = bundleId;
  if (windowTitle.length > 0) app.windowTitle = windowTitle;
  return app;
}

/**
 * Identity key for edge-triggering. The window title is intentionally excluded:
 * an `app_switch` row marks a *change of application*, and within one app the
 * title changes constantly (e.g. switching files in an editor). Including the
 * title would flood the timeline; per-app detail is captured by the browser
 * and IDE sources instead.
 */
function identityKey(app: ActiveApp): string {
  return app.bundleId ?? app.appName;
}

/**
 * Build an `app_switch` Activity from an {@link ActiveApp} reading.
 * Exposed for testing and for the scheduler.
 */
export function toAppSwitchActivity(app: ActiveApp, ts: number = Date.now()): AppSwitchActivity {
  const payload: AppSwitchActivity['payload'] = { appName: app.appName };
  if (app.bundleId !== undefined) payload.bundleId = app.bundleId;
  if (app.windowTitle !== undefined) payload.windowTitle = app.windowTitle;
  return {
    id: randomUUID(),
    type: 'app_switch',
    source: 'app',
    ts,
    payload,
  };
}

/**
 * Edge-trigger detector for the active app. Holds the last-seen identity and
 * returns an `app_switch` Activity only when the identity changes.
 *
 * The scheduler owns one instance; it is the only stateful piece of the app
 * source (the read itself is stateless).
 */
export class AppSwitchDetector {
  private lastIdentity: string | undefined;

  /**
   * Feed a fresh reading. Returns an `app_switch` Activity to persist when the
   * active app changed, or `undefined` when it is the same app as last tick.
   */
  observe(app: ActiveApp, ts: number = Date.now()): AppSwitchActivity | undefined {
    const key = identityKey(app);
    if (key === this.lastIdentity) return undefined;
    this.lastIdentity = key;
    return toAppSwitchActivity(app, ts);
  }

  /** Forget the last-seen app (e.g. after a stop/start cycle). */
  reset(): void {
    this.lastIdentity = undefined;
  }
}
