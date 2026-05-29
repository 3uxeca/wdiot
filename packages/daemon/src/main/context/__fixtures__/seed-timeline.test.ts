import { describe, it, expect } from 'vitest';
import { ActivitySchema } from '@wdiot/shared';
import { createSeedTimeline, SEED_GAP } from './seed-timeline.js';
import { GOLDEN_CASES } from './golden-cases.js';

describe('createSeedTimeline', () => {
  it('produces a chronologically ordered, schema-valid timeline', () => {
    const timeline = createSeedTimeline();
    expect(timeline.length).toBeGreaterThan(10);

    for (let i = 1; i < timeline.length; i++) {
      expect(timeline[i]!.ts).toBeGreaterThanOrEqual(timeline[i - 1]!.ts);
    }
    for (const activity of timeline) {
      expect(ActivitySchema.safeParse(activity).success).toBe(true);
    }
  });

  it('spans across both seed projects via file_edit activities', () => {
    const projectIds = new Set(
      createSeedTimeline()
        .filter((a) => a.type === 'file_edit')
        .map((a) => a.projectId),
    );
    expect(projectIds.size).toBe(2);
  });

  it('embeds a ~7-minute sleep/wake gap', () => {
    const timeline = createSeedTimeline();
    let maxGapMs = 0;
    for (let i = 1; i < timeline.length; i++) {
      maxGapMs = Math.max(maxGapMs, timeline[i]!.ts - timeline[i - 1]!.ts);
    }
    expect(Math.round(maxGapMs / 60_000)).toBe(SEED_GAP.durationMin);
  });

  it('includes app switches, browser tabs, searches, and file edits', () => {
    const types = new Set(createSeedTimeline().map((a) => a.type));
    expect(types).toEqual(new Set(['app_switch', 'browser_tab', 'search', 'file_edit']));
  });
});

describe('GOLDEN_CASES', () => {
  it('defines 3-5 cases with Korean expected values', () => {
    expect(GOLDEN_CASES.length).toBeGreaterThanOrEqual(3);
    expect(GOLDEN_CASES.length).toBeLessThanOrEqual(5);

    const hasHangul = (s: string) => /[가-힣]/.test(s);
    for (const gc of GOLDEN_CASES) {
      expect(gc.timeline.length).toBeGreaterThan(0);
      expect(gc.expected.expectedActions.length).toBeGreaterThan(0);
      for (const action of gc.expected.expectedActions) {
        expect(hasHangul(action.label)).toBe(true);
      }
      for (const phrase of gc.expected.summaryInferencePhrases) {
        expect(hasHangul(phrase)).toBe(true);
      }
    }
  });
});
