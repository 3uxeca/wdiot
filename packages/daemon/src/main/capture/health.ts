/**
 * Per-source capture health — plan B2 ("Capture health").
 *
 * Each capture source (active app, Chrome, Safari) has an independent health
 * state machine with three states:
 *
 *   - `ok`       — capturing normally.
 *   - `degraded` — transient failures (osascript timeout / glitch). The
 *                  scheduler skips the tick but keeps retrying. After
 *                  {@link DENIED_ESCALATION_THRESHOLD} consecutive transient
 *                  failures the source escalates to `denied`.
 *   - `denied`   — a macOS permission denial was detected; persistent until the
 *                  user re-grants permission.
 *
 * The machine also detects mid-session revocation (`ok` -> `denied`) and
 * re-grant (`denied` -> `ok`). It owns no timers and performs no I/O: capture
 * sources report each poll outcome and the machine derives state + Korean
 * user-facing strings for the tray and System Settings deep-links.
 *
 * Work Unit F wires the tray to this module via {@link HealthRegistry}
 * accessors and the `onChange` listener — `health.ts` never imports the tray.
 */

/** Capture source identity. `chrome` / `safari` are independently granted. */
export type CaptureSourceId = 'app' | 'chrome' | 'safari';

/** All capture sources, in tray display order. */
export const CAPTURE_SOURCE_IDS: readonly CaptureSourceId[] = ['app', 'chrome', 'safari'];

/** Health state of a single capture source. */
export type HealthState = 'ok' | 'degraded' | 'denied';

/**
 * Consecutive transient failures after which a `degraded` source escalates to
 * `denied`. Transient errors that persist this long are treated as effectively
 * permanent (e.g. a misconfigured environment that never recovers).
 */
export const DENIED_ESCALATION_THRESHOLD = 5;

/** The kind of macOS permission a source needs, used for deep-link labels. */
export type PermissionKind = 'automation' | 'accessibility';

/** A poll outcome reported by a capture source. */
export type PollOutcome =
  | { kind: 'success' }
  /** A transient failure (osascript timeout, script glitch). */
  | { kind: 'transient' }
  /** A persistent permission denial detected by the osascript runner. */
  | { kind: 'denied' };

/** Immutable health snapshot for one source. */
export interface SourceHealth {
  source: CaptureSourceId;
  state: HealthState;
  /** Count of consecutive transient failures (reset on success / denial). */
  consecutiveFailures: number;
  /** Epoch ms of the last successful poll, or `undefined` if never succeeded. */
  lastOkTs?: number;
}

/** Korean source display names for tray status strings. */
const SOURCE_LABEL_KO: Record<CaptureSourceId, string> = {
  app: '앱',
  chrome: 'Chrome',
  safari: 'Safari',
};

/** Korean state suffixes for tray status strings. */
const STATE_SUFFIX_KO: Record<HealthState, string> = {
  ok: '정상',
  degraded: '불안정',
  denied: '권한 필요',
};

/** Which macOS permission each source depends on. */
const SOURCE_PERMISSION: Record<CaptureSourceId, PermissionKind> = {
  // The default app source uses System Events, which needs Accessibility.
  app: 'accessibility',
  chrome: 'automation',
  safari: 'automation',
};

/** Korean System Settings deep-link labels per permission kind + source. */
function settingsLinkLabel(source: CaptureSourceId): string {
  switch (SOURCE_PERMISSION[source]) {
    case 'automation':
      return `${SOURCE_LABEL_KO[source]} 자동화 권한 필요 — 설정 열기`;
    case 'accessibility':
      return '손쉬운 사용 권한 필요 — 설정 열기';
  }
}

/**
 * Health state machine for a single capture source. Pure: no timers, no I/O.
 * Capture sources call {@link report} after every poll.
 */
export class SourceHealthMachine {
  readonly source: CaptureSourceId;
  private state: HealthState = 'ok';
  private consecutiveFailures = 0;
  private lastOkTs: number | undefined;

  constructor(source: CaptureSourceId) {
    this.source = source;
  }

  /** Current immutable snapshot. */
  snapshot(): SourceHealth {
    return {
      source: this.source,
      state: this.state,
      consecutiveFailures: this.consecutiveFailures,
      lastOkTs: this.lastOkTs,
    };
  }

  /**
   * Apply a poll outcome and return whether the *state* changed (a transition
   * a caller may want to surface). Failure-count changes that do not move the
   * state return `false`.
   */
  report(outcome: PollOutcome, nowTs: number = Date.now()): boolean {
    const prev = this.state;

    switch (outcome.kind) {
      case 'success':
        // Success always clears failures and restores `ok` — this is how both
        // transient recovery and denied -> ok re-grant are detected.
        this.consecutiveFailures = 0;
        this.lastOkTs = nowTs;
        this.state = 'ok';
        break;

      case 'denied':
        // Immediate, persistent. Detects mid-session revocation (ok -> denied).
        this.consecutiveFailures = 0;
        this.state = 'denied';
        break;

      case 'transient':
        this.consecutiveFailures += 1;
        // A denied source stays denied until an explicit success; a transient
        // blip while denied does not "downgrade" it to degraded.
        if (this.state !== 'denied') {
          this.state =
            this.consecutiveFailures >= DENIED_ESCALATION_THRESHOLD
              ? 'denied'
              : 'degraded';
        }
        break;
    }

    return this.state !== prev;
  }
}

/** A health-change event delivered to listeners. */
export interface HealthChangeEvent {
  source: CaptureSourceId;
  previous: HealthState;
  current: HealthState;
}

type HealthChangeListener = (event: HealthChangeEvent) => void;

/**
 * Registry of all capture-source health machines. This is the public health
 * accessor the scheduler updates and Work Unit F reads for the tray.
 */
export class HealthRegistry {
  private readonly machines: Map<CaptureSourceId, SourceHealthMachine> = new Map();
  private readonly listeners: Set<HealthChangeListener> = new Set();

  constructor() {
    for (const id of CAPTURE_SOURCE_IDS) {
      this.machines.set(id, new SourceHealthMachine(id));
    }
  }

  /** Report a poll outcome for a source; notifies listeners on state change. */
  report(source: CaptureSourceId, outcome: PollOutcome, nowTs: number = Date.now()): void {
    const machine = this.machines.get(source);
    if (!machine) throw new Error(`unknown capture source: ${source}`);
    const previous = machine.snapshot().state;
    const changed = machine.report(outcome, nowTs);
    if (changed) {
      const current = machine.snapshot().state;
      for (const listener of this.listeners) {
        listener({ source, previous, current });
      }
    }
  }

  /** Snapshot for one source. */
  get(source: CaptureSourceId): SourceHealth {
    const machine = this.machines.get(source);
    if (!machine) throw new Error(`unknown capture source: ${source}`);
    return machine.snapshot();
  }

  /** Snapshot for every source, in {@link CAPTURE_SOURCE_IDS} order. */
  all(): SourceHealth[] {
    return CAPTURE_SOURCE_IDS.map((id) => this.get(id));
  }

  /** `true` if any source is currently `denied`. */
  hasDenied(): boolean {
    return this.all().some((h) => h.state === 'denied');
  }

  /**
   * Subscribe to health-state transitions. Returns an unsubscribe function.
   * Work Unit F uses this to refresh the tray indicator without a restart.
   */
  onChange(listener: HealthChangeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

/**
 * Korean tray status string for one source, e.g. `"Chrome: 정상"`,
 * `"Safari: 권한 필요"`, `"앱: 불안정"`.
 */
export function trayStatusString(health: SourceHealth): string {
  return `${SOURCE_LABEL_KO[health.source]}: ${STATE_SUFFIX_KO[health.state]}`;
}

/** Korean tray status strings for every source, in display order. */
export function trayStatusStrings(registry: HealthRegistry): string[] {
  return registry.all().map(trayStatusString);
}

/**
 * Korean System Settings deep-link label for a `denied` source, or `undefined`
 * if the source is not denied. e.g.
 * `"Chrome 자동화 권한 필요 — 설정 열기"`,
 * `"손쉬운 사용 권한 필요 — 설정 열기"`.
 */
export function settingsLinkForSource(health: SourceHealth): string | undefined {
  if (health.state !== 'denied') return undefined;
  return settingsLinkLabel(health.source);
}

/** The macOS permission kind a source depends on (for tray deep-linking). */
export function permissionKindForSource(source: CaptureSourceId): PermissionKind {
  return SOURCE_PERMISSION[source];
}
