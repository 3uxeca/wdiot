import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Activity } from '@wdiot/shared';
import { openDatabase, type Db } from '../storage/db.js';
import { insertActivities } from '../storage/activity-repo.js';
import {
  assembleContextWindow,
  detectLargestGap,
  DEFAULT_RANGE_MINUTES,
  GAP_THRESHOLD_MIN,
} from './assembler.js';
import { createSeedTimeline, SEED_END_TS, SEED_GAP } from './__fixtures__/seed-timeline.js';
import { seedProjects } from './__fixtures__/seed-projects.js';

const MIN = 60_000;

let db: Db;

beforeEach(() => {
  db = openDatabase(':memory:');
  seedProjects(db);
});

afterEach(() => {
  db.close();
});

describe('detectLargestGap', () => {
  it('returns undefined when no gap exceeds the threshold', () => {
    const tight: Activity[] = [0, 1, 2, 3].map((i) => ({
      id: `t-${i}`,
      type: 'app_switch',
      source: 'app',
      ts: 1000 + i * MIN,
      payload: { appName: 'Cursor' },
    }));
    expect(detectLargestGap(tight)).toBeUndefined();
  });

  it('finds the largest gap and the post-gap anchor index', () => {
    const ts = (m: number) => 1_000_000 + m * MIN;
    const events: Activity[] = [
      { id: 'a', type: 'app_switch', source: 'app', ts: ts(0), payload: { appName: 'A' } },
      { id: 'b', type: 'app_switch', source: 'app', ts: ts(6), payload: { appName: 'B' } },
      { id: 'c', type: 'app_switch', source: 'app', ts: ts(7), payload: { appName: 'C' } },
      { id: 'd', type: 'app_switch', source: 'app', ts: ts(20), payload: { appName: 'D' } },
    ];
    const detected = detectLargestGap(events);
    expect(detected).toBeDefined();
    // largest gap is 7->20 (13 min), anchor index 3.
    expect(detected!.anchorIndex).toBe(3);
    expect(detected!.gap.durationMin).toBe(13);
    expect(detected!.gap.from).toBe(ts(7));
    expect(detected!.gap.to).toBe(ts(20));
  });
});

describe('assembleContextWindow', () => {
  it('builds a bounded window from the seeded timeline', () => {
    insertActivities(db, createSeedTimeline());
    const window = assembleContextWindow(db, { now: SEED_END_TS });

    expect(window.rangeMinutes).toBe(DEFAULT_RANGE_MINUTES);
    expect(window.assembledAt).toBe(SEED_END_TS);
    expect(window.activities.length).toBeGreaterThan(0);
    // activities are ts-ascending.
    for (let i = 1; i < window.activities.length; i++) {
      expect(window.activities[i]!.ts).toBeGreaterThanOrEqual(
        window.activities[i - 1]!.ts,
      );
    }
  });

  it('detects the embedded 7-minute sleep/wake gap and anchors post-gap', () => {
    insertActivities(db, createSeedTimeline());
    const window = assembleContextWindow(db, { now: SEED_END_TS });

    expect(window.gapDetected).toBeDefined();
    expect(window.gapDetected!.durationMin).toBe(SEED_GAP.durationMin);

    // every retained activity is at or after the post-gap anchor (18 min ago).
    const anchorTs = SEED_END_TS - SEED_GAP.toMinutesAgo * MIN;
    for (const activity of window.activities) {
      expect(activity.ts).toBeGreaterThanOrEqual(anchorTs);
    }

    // the pre-gap billing-api cluster (25-29 min ago) is excluded.
    const preGapTs = SEED_END_TS - SEED_GAP.fromMinutesAgo * MIN;
    expect(window.activities.some((a) => a.ts <= preGapTs)).toBe(false);
  });

  it('the gap annotation spans from the last pre-gap to the first post-gap event', () => {
    insertActivities(db, createSeedTimeline());
    const window = assembleContextWindow(db, { now: SEED_END_TS });

    const gap = window.gapDetected!;
    expect(gap.to - gap.from).toBe(SEED_GAP.durationMin * MIN);
    // the first retained activity is the event right after the gap.
    expect(window.activities[0]!.ts).toBe(gap.to);
  });

  it('returns an empty window with no gap when nothing is in range', () => {
    insertActivities(db, createSeedTimeline());
    // "now" far in the future — nothing within the 30-min range.
    const window = assembleContextWindow(db, { now: SEED_END_TS + 1000 * MIN });
    expect(window.activities).toHaveLength(0);
    expect(window.gapDetected).toBeUndefined();
  });

  it('respects the limit (hard event cap) passed through to the slice', () => {
    insertActivities(db, createSeedTimeline());
    const window = assembleContextWindow(db, { now: SEED_END_TS, limit: 3 });
    // sliced to 3 events; no gap > threshold among 3 adjacent recent events.
    expect(window.activities.length).toBeLessThanOrEqual(3);
  });

  it('keeps GAP_THRESHOLD_MIN below the seeded gap so the gap is detectable', () => {
    expect(GAP_THRESHOLD_MIN).toBeLessThan(SEED_GAP.durationMin);
  });
});
