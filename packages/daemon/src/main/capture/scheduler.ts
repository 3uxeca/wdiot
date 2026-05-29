/**
 * Capture scheduler — plan B2 ("Capture scheduling").
 *
 * Owns two independent timers:
 *   - **App timer** (~1-2 s) — polls the active app (`app-source.ts`).
 *   - **Browser timer** (~5-10 s) — polls Chrome + Safari (`browser-source.ts`).
 *
 * Each source poll is `async` and **serialized per source** with a
 * re-entrancy guard: if a tick fires while the previous poll of that source
 * has not yet resolved, the tick is skipped. The underlying `osascript` calls
 * carry their own hard timeout + abort (`applescript.ts`), so a hung
 * AppleScript can never stall the loop.
 *
 * The scheduler is the only stateful capture component that touches the DB:
 * it persists Activities via `storage/activity-repo.ts` `insertActivity` and
 * routes every poll outcome to the `HealthRegistry`. It imports neither the
 * tray nor `main/index.ts` — Work Unit F wires those via the exposed
 * `health` accessor and start/stop API.
 */
import type { Activity } from '@wdiot/shared';
import type { Db } from '../storage/db.js';
import { insertActivity } from '../storage/activity-repo.js';
import {
  AppSwitchDetector,
  readActiveApp,
} from './app-source.js';
import {
  pollBrowser,
  tabsToActivities,
  type BrowserPollResult,
} from './browser-source.js';
import { OsascriptError } from './applescript.js';
import {
  HealthRegistry,
  type CaptureSourceId,
  type PollOutcome,
} from './health.js';

/** Default app-poll interval (ms). Plan B2: ~1-2 s. */
export const DEFAULT_APP_INTERVAL_MS = 1500;

/** Default browser-poll interval (ms). Plan B2: ~5-10 s. */
export const DEFAULT_BROWSER_INTERVAL_MS = 7000;

/** Tunable scheduler intervals. */
export interface SchedulerOptions {
  /** Active-app poll interval in ms. Default {@link DEFAULT_APP_INTERVAL_MS}. */
  appIntervalMs?: number;
  /** Browser poll interval in ms. Default {@link DEFAULT_BROWSER_INTERVAL_MS}. */
  browserIntervalMs?: number;
  /**
   * Sink for persisting captured Activities. Defaults to
   * `activity-repo.insertActivity`. Overridable for tests.
   */
  persist?: (activity: Activity) => void;
}

/** Map an `osascript` failure kind to a health poll outcome. */
function failureToOutcome(failure: 'denied' | 'timeout' | 'error'): PollOutcome {
  return failure === 'denied' ? { kind: 'denied' } : { kind: 'transient' };
}

/**
 * The capture scheduler. Construct once with an open DB handle, then
 * `start()` / `stop()`. `health` is the public per-source health accessor for
 * Work Unit F (tray integration).
 */
export class CaptureScheduler {
  /** Per-source health — Work Unit F reads this for the tray. */
  readonly health: HealthRegistry = new HealthRegistry();

  private readonly appIntervalMs: number;
  private readonly browserIntervalMs: number;
  private readonly persist: (activity: Activity) => void;

  private readonly appDetector = new AppSwitchDetector();

  private appTimer: NodeJS.Timeout | undefined;
  private browserTimer: NodeJS.Timeout | undefined;
  private running = false;

  // Re-entrancy guards — `true` while a poll for that source is in flight.
  private appPollInFlight = false;
  private browserPollInFlight = false;

  // Abort controllers for in-flight polls, so `stop()` cancels promptly.
  private appAbort: AbortController | undefined;
  private browserAbort: AbortController | undefined;

  constructor(
    private readonly db: Db,
    options: SchedulerOptions = {},
  ) {
    this.appIntervalMs = options.appIntervalMs ?? DEFAULT_APP_INTERVAL_MS;
    this.browserIntervalMs = options.browserIntervalMs ?? DEFAULT_BROWSER_INTERVAL_MS;
    this.persist =
      options.persist ?? ((activity) => insertActivity(this.db, activity));
  }

  /** `true` between `start()` and `stop()`. */
  get isRunning(): boolean {
    return this.running;
  }

  /** Start both capture timers. Idempotent. */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.appDetector.reset();

    // Kick an immediate first poll so an app switch right after launch is not
    // missed for a whole interval, then schedule the recurring ticks.
    void this.runAppPoll();
    void this.runBrowserPoll();

    this.appTimer = setInterval(() => {
      void this.runAppPoll();
    }, this.appIntervalMs);
    this.browserTimer = setInterval(() => {
      void this.runBrowserPoll();
    }, this.browserIntervalMs);
  }

  /** Stop both timers and abort any in-flight polls. Idempotent. */
  stop(): void {
    if (!this.running) return;
    this.running = false;

    if (this.appTimer) {
      clearInterval(this.appTimer);
      this.appTimer = undefined;
    }
    if (this.browserTimer) {
      clearInterval(this.browserTimer);
      this.browserTimer = undefined;
    }
    this.appAbort?.abort();
    this.browserAbort?.abort();
  }

  /**
   * Poll the active app once. Re-entrancy guarded: a tick is skipped if the
   * previous app poll has not resolved.
   */
  private async runAppPoll(): Promise<void> {
    if (this.appPollInFlight) return; // serialized per source — skip this tick
    this.appPollInFlight = true;
    const abort = new AbortController();
    this.appAbort = abort;

    try {
      const app = await readActiveApp(abort.signal);
      if (!this.running) return; // stopped mid-poll — drop the result

      const activity = this.appDetector.observe(app);
      if (activity) {
        // Edge-triggered: only persist on an actual app-identity change.
        this.persist(activity);
      }
      this.health.report('app', { kind: 'success' });
    } catch (err) {
      if (!this.running) return;
      this.health.report('app', this.classifyError(err));
    } finally {
      this.appPollInFlight = false;
      if (this.appAbort === abort) this.appAbort = undefined;
    }
  }

  /**
   * Poll both browsers once. Re-entrancy guarded for the browser source as a
   * whole; Chrome and Safari run concurrently within a tick but report to
   * their own health machines independently.
   */
  private async runBrowserPoll(): Promise<void> {
    if (this.browserPollInFlight) return; // serialized — skip this tick
    this.browserPollInFlight = true;
    const abort = new AbortController();
    this.browserAbort = abort;

    try {
      const results = await Promise.all([
        pollBrowser('chrome', abort.signal),
        pollBrowser('safari', abort.signal),
      ]);
      if (!this.running) return; // stopped mid-poll — drop the results

      for (const result of results) {
        this.handleBrowserResult(result);
      }
    } finally {
      this.browserPollInFlight = false;
      if (this.browserAbort === abort) this.browserAbort = undefined;
    }
  }

  /** Persist tabs/searches and report health for one browser's poll result. */
  private handleBrowserResult(result: BrowserPollResult): void {
    const source: CaptureSourceId = result.browser; // 'chrome' | 'safari'
    if (result.ok) {
      for (const activity of tabsToActivities(result.tabs)) {
        this.persist(activity);
      }
      this.health.report(source, { kind: 'success' });
    } else {
      this.health.report(source, failureToOutcome(result.failure));
    }
  }

  /** Map an unknown thrown value into a health {@link PollOutcome}. */
  private classifyError(err: unknown): PollOutcome {
    if (err instanceof OsascriptError) {
      return failureToOutcome(err.kind);
    }
    return { kind: 'transient' };
  }
}
