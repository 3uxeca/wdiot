import { describe, it, expect } from 'vitest';
import type { Activity, ContextWindow } from '@wdiot/shared';
import { ContextDigestSchema } from '@wdiot/shared';
import { compressContextWindow, DIGEST_SECTION_BUDGET } from './compressor.js';
import { createSeedTimeline, SEED_END_TS } from './__fixtures__/seed-timeline.js';
import { assembleContextWindow, DEFAULT_RANGE_MINUTES } from './assembler.js';
import { openDatabase } from '../storage/db.js';
import { insertActivities } from '../storage/activity-repo.js';
import { seedProjects } from './__fixtures__/seed-projects.js';

const MIN = 60_000;

function windowOf(activities: Activity[], gap?: ContextWindow['gapDetected']): ContextWindow {
  return {
    rangeMinutes: DEFAULT_RANGE_MINUTES,
    assembledAt: SEED_END_TS,
    activities,
    ...(gap ? { gapDetected: gap } : {}),
  };
}

describe('compressContextWindow', () => {
  it('produces a schema-valid digest from the seeded timeline', async () => {
    const db = openDatabase(':memory:');
    seedProjects(db);
    insertActivities(db, createSeedTimeline());
    const window = assembleContextWindow(db, { now: SEED_END_TS });
    db.close();

    const digest = await compressContextWindow(window);
    expect(ContextDigestSchema.safeParse(digest).success).toBe(true);
    expect(digest.rangeMinutes).toBe(DEFAULT_RANGE_MINUTES);
    expect(digest.assembledAt).toBe(SEED_END_TS);
  });

  it('run-length collapses consecutive same-app switches into one span', async () => {
    const apps: Activity[] = [
      { id: '1', type: 'app_switch', source: 'app', ts: 1000, payload: { appName: 'Cursor' } },
      { id: '2', type: 'app_switch', source: 'app', ts: 2000, payload: { appName: 'Cursor' } },
      { id: '3', type: 'app_switch', source: 'app', ts: 3000, payload: { appName: 'Cursor' } },
      { id: '4', type: 'app_switch', source: 'app', ts: 4000, payload: { appName: 'Chrome' } },
      { id: '5', type: 'app_switch', source: 'app', ts: 5000, payload: { appName: 'Cursor' } },
    ];
    const digest = await compressContextWindow(windowOf(apps));
    // Cursor x3 collapses to one span, Chrome one, Cursor again one = 3 spans.
    expect(digest.apps).toHaveLength(3);
    expect(digest.apps[0]).toEqual({ appName: 'Cursor', from: 1000, to: 4000 });
    expect(digest.apps[1]!.appName).toBe('Chrome');
    expect(digest.apps[2]!.appName).toBe('Cursor');
  });

  it('dedupes browser tabs by URL keeping the latest visit', async () => {
    const tabs: Activity[] = [
      {
        id: '1', type: 'browser_tab', source: 'browser', ts: 1000,
        payload: { browser: 'chrome', url: 'https://a.com', title: 'A old', active: true },
      },
      {
        id: '2', type: 'browser_tab', source: 'browser', ts: 5000,
        payload: { browser: 'chrome', url: 'https://a.com', title: 'A new', active: true },
      },
      {
        id: '3', type: 'browser_tab', source: 'browser', ts: 3000,
        payload: { browser: 'safari', url: 'https://b.com', title: 'B', active: true },
      },
    ];
    const digest = await compressContextWindow(windowOf(tabs));
    expect(digest.browser).toHaveLength(2);
    const a = digest.browser.find((b) => b.url === 'https://a.com')!;
    expect(a.title).toBe('A new');
    expect(a.lastVisitTs).toBe(5000);
  });

  it('collapses repeated file edits of the same path with an edit count', async () => {
    const ws = '/Users/dev/code/proj';
    const file = `${ws}/src/x.ts`;
    const edits: Activity[] = [10, 20, 30].map((t, i) => ({
      id: `e-${i}`,
      type: 'file_edit',
      source: 'ide',
      ts: t,
      projectId: 'p',
      payload: { workspacePath: ws, filePath: file, cursorLine: t, hasGitDiff: i === 2 },
    }));
    const digest = await compressContextWindow(windowOf(edits));
    expect(digest.files).toHaveLength(1);
    expect(digest.files[0]!.editCount).toBe(3);
    expect(digest.files[0]!.lastCursorLine).toBe(30);
    expect(digest.files[0]!.hasGitDiff).toBe(true);
  });

  it('dedupes searches by (engine, query)', async () => {
    const mkSearch = (id: string, ts: number, query: string): Activity => ({
      id, type: 'search', source: 'browser', ts,
      payload: {
        browser: 'chrome', engine: 'google', query,
        url: `https://www.google.com/search?q=${encodeURIComponent(query)}`,
      },
    });
    const searches = [
      mkSearch('s1', 1000, 'chartjs zoom'),
      mkSearch('s2', 2000, 'chartjs zoom'),
      mkSearch('s3', 3000, 'stripe rounding'),
    ];
    const digest = await compressContextWindow(windowOf(searches));
    expect(digest.searches).toHaveLength(2);
  });

  it('carries the gap annotation into the digest', async () => {
    const gap = { from: 1000, to: 1000 + 8 * MIN, durationMin: 8 };
    const digest = await compressContextWindow(windowOf([], gap));
    expect(digest.gapDetected).toEqual(gap);
  });

  it('flags truncated and keeps the budget when a section overflows', async () => {
    const many: Activity[] = Array.from({ length: DIGEST_SECTION_BUDGET + 25 }, (_, i) => ({
      id: `b-${i}`,
      type: 'browser_tab',
      source: 'browser',
      ts: 1000 + i,
      payload: {
        browser: 'chrome',
        url: `https://site-${i}.com`,
        title: `Site ${i}`,
        active: true,
      },
    }));
    const digest = await compressContextWindow(windowOf(many));
    expect(digest.truncated).toBe(true);
    expect(digest.browser.length).toBe(DIGEST_SECTION_BUDGET);
  });

  it('does not flag truncated for a small window', async () => {
    const digest = await compressContextWindow(
      windowOf([
        { id: '1', type: 'app_switch', source: 'app', ts: 1000, payload: { appName: 'Cursor' } },
      ]),
    );
    expect(digest.truncated).toBe(false);
  });
});
