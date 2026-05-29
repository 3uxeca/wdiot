/**
 * Context-window assembler — plan Boundary 5, phase 1.
 *
 * On hotkey press the daemon slices the recent activity timeline and builds a
 * `ContextWindow`. A sleep/wake (or distraction) gap longer than the threshold
 * re-anchors the effective window start to the post-gap activity cluster — the
 * "returning after a break" scenario is WDIOT's primary trigger.
 */
import type { Activity, ContextWindow, GapAnnotation } from '@wdiot/shared';
import { sliceActivities, HARD_EVENT_CAP } from '../storage/activity-repo.js';
import type { Db } from '../storage/db.js';

/** Default context window length (plan: ~30 min). */
export const DEFAULT_RANGE_MINUTES = 30;

/** A gap longer than this between consecutive events anchors the window. */
export const GAP_THRESHOLD_MIN = 5;

const MIN = 60_000;

/** Options for {@link assembleContextWindow}. */
export interface AssembleOptions {
  /** window length in minutes (defaults to {@link DEFAULT_RANGE_MINUTES}). */
  rangeMinutes?: number;
  /** epoch ms "now"; defaults to `Date.now()` (overridable for tests). */
  now?: number;
  /** hard event cap for the SQL slice (defaults to {@link HARD_EVENT_CAP}). */
  limit?: number;
}

/**
 * Scan a `ts`-ascending activity list for the LARGEST gap exceeding
 * {@link GAP_THRESHOLD_MIN}. Returns the gap annotation and the index of the
 * first event AFTER that gap, or `undefined` when no qualifying gap exists.
 */
export function detectLargestGap(
  activities: readonly Activity[],
): { gap: GapAnnotation; anchorIndex: number } | undefined {
  let bestDurationMs = GAP_THRESHOLD_MIN * MIN;
  let result: { gap: GapAnnotation; anchorIndex: number } | undefined;

  for (let i = 1; i < activities.length; i++) {
    const prev = activities[i - 1]!;
    const next = activities[i]!;
    const durationMs = next.ts - prev.ts;
    if (durationMs > bestDurationMs) {
      bestDurationMs = durationMs;
      result = {
        gap: {
          from: prev.ts,
          to: next.ts,
          durationMin: durationMs / MIN,
        },
        anchorIndex: i,
      };
    }
  }

  return result;
}

/**
 * Build a {@link ContextWindow} from a bounded time slice.
 *
 * 1. Slice `activities` with `ts >= now - rangeMinutes*60000`, capped at `limit`.
 * 2. Detect the largest sleep/wake gap; if one is found, drop everything before
 *    the post-gap cluster and record a `gapDetected` annotation.
 */
export function assembleContextWindow(
  db: Db,
  options: AssembleOptions = {},
): ContextWindow {
  const rangeMinutes = options.rangeMinutes ?? DEFAULT_RANGE_MINUTES;
  const now = options.now ?? Date.now();
  const limit = options.limit ?? HARD_EVENT_CAP;

  const sinceTs = now - rangeMinutes * MIN;
  const slice = sliceActivities(db, sinceTs, limit);

  const detected = detectLargestGap(slice);
  if (!detected) {
    return {
      rangeMinutes,
      assembledAt: now,
      activities: slice,
    };
  }

  return {
    rangeMinutes,
    assembledAt: now,
    activities: slice.slice(detected.anchorIndex),
    gapDetected: detected.gap,
  };
}
