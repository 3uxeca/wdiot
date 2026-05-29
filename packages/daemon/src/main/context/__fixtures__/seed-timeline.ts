/**
 * Seeded timeline fixture (plan Work Unit A).
 *
 * `createSeedTimeline()` generates a deterministic, realistic ~30-minute
 * `Activity[]` used by assembler/compressor unit tests (Work Unit D) and the
 * golden cases below. It includes app switches, Chrome/Safari tabs, search
 * queries, file edits across two projects, and an embedded 7-minute
 * sleep/wake gap.
 */
import { randomUUID } from 'node:crypto';
import type { Activity } from '@wdiot/shared';

/** Two workspaces represented in the seeded timeline. */
export const SEED_PROJECTS = {
  dashboard: {
    id: 'seed-project-dashboard',
    workspace: '/Users/dev/code/analytics-dashboard',
    name: 'analytics-dashboard',
  },
  api: {
    id: 'seed-project-api',
    workspace: '/Users/dev/code/billing-api',
    name: 'billing-api',
  },
} as const;

/** Options for {@link createSeedTimeline}. */
export interface SeedTimelineOptions {
  /** epoch ms the window "ends" at (defaults to a fixed reference time). */
  endTs?: number;
}

/** Fixed reference end time so the fixture is fully deterministic. */
export const SEED_END_TS = Date.UTC(2026, 4, 20, 14, 30, 0); // 2026-05-20 14:30:00Z

const MIN = 60_000;

interface SeedSpec {
  /** minutes before `endTs` */
  minutesAgo: number;
  build: (ts: number) => Omit<Activity, 'id'>;
}

function app(appName: string, windowTitle: string): (ts: number) => Omit<Activity, 'id'> {
  return (ts) => ({
    type: 'app_switch',
    source: 'app',
    ts,
    payload: { appName, windowTitle },
  });
}

function tab(
  browser: 'chrome' | 'safari',
  url: string,
  title: string,
  active = true,
): (ts: number) => Omit<Activity, 'id'> {
  return (ts) => ({
    type: 'browser_tab',
    source: 'browser',
    ts,
    payload: { browser, url, title, active },
  });
}

function search(
  browser: 'chrome' | 'safari',
  engine: string,
  query: string,
): (ts: number) => Omit<Activity, 'id'> {
  return (ts) => ({
    type: 'search',
    source: 'browser',
    ts,
    payload: {
      browser,
      engine,
      query,
      url: `https://www.${engine}.com/search?q=${encodeURIComponent(query)}`,
    },
  });
}

function fileEdit(
  project: { id: string; workspace: string },
  filePath: string,
  cursorLine: number,
  hasGitDiff: boolean,
  recentFiles: string[] = [],
): (ts: number) => Omit<Activity, 'id'> {
  return (ts) => ({
    type: 'file_edit',
    source: 'ide',
    ts,
    projectId: project.id,
    payload: {
      workspacePath: project.workspace,
      filePath,
      recentFiles,
      cursorLine,
      hasGitDiff,
    },
  });
}

/**
 * The chronological spec. `minutesAgo` counts back from `endTs`; note the
 * jump from 25 -> 18 minutes-ago which embeds the 7-minute sleep/wake gap.
 */
const SEED_SPEC: SeedSpec[] = [
  // --- pre-gap cluster: working on billing-api ---------------------------
  { minutesAgo: 29, build: app('Cursor', 'billing-api — invoice.ts') },
  {
    minutesAgo: 28,
    build: fileEdit(SEED_PROJECTS.api, `${SEED_PROJECTS.api.workspace}/src/invoice.ts`, 88, true, [
      `${SEED_PROJECTS.api.workspace}/src/invoice.ts`,
    ]),
  },
  { minutesAgo: 27, build: app('Google Chrome', 'Stripe API Reference') },
  {
    minutesAgo: 27,
    build: tab('chrome', 'https://docs.stripe.com/api/invoices', 'Invoices | Stripe API'),
  },
  { minutesAgo: 26, build: search('chrome', 'google', 'stripe invoice line items rounding') },
  { minutesAgo: 25, build: app('Cursor', 'billing-api — invoice.ts') },
  // --- 7-minute sleep/wake gap here (25 -> 18 minutesAgo) ----------------
  // --- post-gap cluster: switched to analytics-dashboard ----------------
  { minutesAgo: 18, build: app('Cursor', 'analytics-dashboard — QueueChart.tsx') },
  {
    minutesAgo: 17,
    build: fileEdit(
      SEED_PROJECTS.dashboard,
      `${SEED_PROJECTS.dashboard.workspace}/src/QueueChart.tsx`,
      142,
      true,
      [`${SEED_PROJECTS.dashboard.workspace}/src/QueueChart.tsx`],
    ),
  },
  { minutesAgo: 16, build: app('Google Chrome', 'chartjs annotation zoom — Google 검색') },
  { minutesAgo: 16, build: search('chrome', 'google', 'chartjs annotation zoom offset') },
  {
    minutesAgo: 15,
    build: tab(
      'chrome',
      'https://www.chartjs.org/chartjs-plugin-annotation/latest/',
      'Annotation Plugin | Chart.js',
    ),
  },
  {
    minutesAgo: 14,
    build: tab(
      'chrome',
      'https://github.com/chartjs/chartjs-plugin-annotation/issues/812',
      'Annotation offset wrong after zoom · Issue #812',
    ),
  },
  { minutesAgo: 12, build: app('Cursor', 'analytics-dashboard — QueueChart.tsx') },
  {
    minutesAgo: 11,
    build: fileEdit(
      SEED_PROJECTS.dashboard,
      `${SEED_PROJECTS.dashboard.workspace}/src/QueueChart.tsx`,
      156,
      true,
      [
        `${SEED_PROJECTS.dashboard.workspace}/src/QueueChart.tsx`,
        `${SEED_PROJECTS.dashboard.workspace}/src/chartOptions.ts`,
      ],
    ),
  },
  {
    minutesAgo: 9,
    build: fileEdit(
      SEED_PROJECTS.dashboard,
      `${SEED_PROJECTS.dashboard.workspace}/src/chartOptions.ts`,
      34,
      true,
      [
        `${SEED_PROJECTS.dashboard.workspace}/src/chartOptions.ts`,
        `${SEED_PROJECTS.dashboard.workspace}/src/QueueChart.tsx`,
      ],
    ),
  },
  { minutesAgo: 7, build: app('Safari', 'Stack Overflow') },
  { minutesAgo: 7, build: search('safari', 'google', 'chart.js annotation yScaleID offset') },
  {
    minutesAgo: 6,
    build: tab(
      'safari',
      'https://stackoverflow.com/questions/64827374/chartjs-annotation-position',
      'javascript - Chart.js annotation position - Stack Overflow',
    ),
  },
  { minutesAgo: 4, build: app('Cursor', 'analytics-dashboard — QueueChart.tsx') },
  {
    minutesAgo: 3,
    build: fileEdit(
      SEED_PROJECTS.dashboard,
      `${SEED_PROJECTS.dashboard.workspace}/src/QueueChart.tsx`,
      161,
      true,
      [`${SEED_PROJECTS.dashboard.workspace}/src/QueueChart.tsx`],
    ),
  },
  { minutesAgo: 1, build: app('Slack', 'analytics-dashboard') },
];

/**
 * Build the seeded ~30-minute timeline. Activities are returned ordered by
 * `ts` ascending, each with a fresh uuid.
 */
export function createSeedTimeline(options: SeedTimelineOptions = {}): Activity[] {
  const endTs = options.endTs ?? SEED_END_TS;
  return SEED_SPEC.map((spec): Activity => {
    const ts = endTs - spec.minutesAgo * MIN;
    return { id: randomUUID(), ...spec.build(ts) } as Activity;
  }).sort((a, b) => a.ts - b.ts);
}

/**
 * The embedded sleep/wake gap, as a known fact for assembler tests: the gap
 * runs from 25 minutes-ago to 18 minutes-ago (7 minutes).
 */
export const SEED_GAP = {
  durationMin: 7,
  fromMinutesAgo: 25,
  toMinutesAgo: 18,
} as const;
