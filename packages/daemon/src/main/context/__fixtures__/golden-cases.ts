/**
 * Golden cases (plan Work Unit A / AC #9).
 *
 * Each case pairs a seeded `Activity[]` timeline with the *expected shape* of
 * the `IntentResult` the LLM should produce. All expected `intent.summary`,
 * `evidence[]`, and `actions[].label` values are written in Korean.
 *
 * These are reference fixtures for Work Unit D's golden-case tests; they
 * intentionally express expectations as a flexible shape (substring / kind /
 * label checks) rather than exact LLM output, which is non-deterministic.
 */
import type { Activity, ResumeActionKind } from '@wdiot/shared';
import { createSeedTimeline, SEED_PROJECTS } from './seed-timeline.js';

/** Expected shape of one resume action (Korean label + kind). */
export interface ExpectedAction {
  /** exact Korean label expected */
  label: string;
  kind: ResumeActionKind;
}

/** A flexible expectation over an `IntentResult`. */
export interface ExpectedIntent {
  /** Korean substrings that the intent summary should contain (intent verbs). */
  summaryMustContain: string[];
  /** the intent summary should read as inference — these phrases hint at that. */
  summaryInferencePhrases: string[];
  /** Korean substrings expected somewhere across the evidence bullets. */
  evidenceMustContain: string[];
  /** expected resume actions (Korean labels) */
  expectedActions: ExpectedAction[];
}

/** One golden case: a seeded timeline plus its expected `IntentResult` shape. */
export interface GoldenCase {
  id: string;
  /** Korean human-readable scenario description. */
  description: string;
  timeline: Activity[];
  expected: ExpectedIntent;
}

/** Standard three resume actions, all Korean-labelled. */
const STANDARD_ACTIONS: ExpectedAction[] = [
  { label: '작업 이어가기', kind: 'resume_work' },
  { label: '관련 탭 열기', kind: 'open_tabs' },
  { label: '타임라인 보기', kind: 'show_timeline' },
];

/**
 * Case 1 — the full seeded timeline. After a 7-minute break the developer was
 * debugging a Chart.js annotation offset bug in analytics-dashboard.
 */
const caseChartAnnotation: GoldenCase = {
  id: 'chart-annotation-bug',
  description:
    '7분 휴식 후 analytics-dashboard에서 Chart.js 주석 위치 어긋남 버그를 디버깅하던 상황.',
  timeline: createSeedTimeline(),
  expected: {
    summaryMustContain: ['Chart.js', '버그'],
    summaryInferencePhrases: ['아마', '거예요'],
    evidenceMustContain: ['QueueChart.tsx', 'chartOptions.ts'],
    expectedActions: STANDARD_ACTIONS,
  },
};

/**
 * Case 2 — a Stripe-invoice rounding investigation in billing-api (pre-gap
 * cluster used as a standalone timeline).
 */
const caseStripeInvoice: GoldenCase = {
  id: 'stripe-invoice-rounding',
  description: 'billing-api에서 Stripe 인보이스 항목 반올림 문제를 조사하던 상황.',
  timeline: [
    {
      id: 'g2-1',
      type: 'app_switch',
      source: 'app',
      ts: 1_700_000_000_000,
      payload: { appName: 'Cursor', windowTitle: 'billing-api — invoice.ts' },
    },
    {
      id: 'g2-2',
      type: 'file_edit',
      source: 'ide',
      ts: 1_700_000_060_000,
      projectId: SEED_PROJECTS.api.id,
      payload: {
        workspacePath: SEED_PROJECTS.api.workspace,
        filePath: `${SEED_PROJECTS.api.workspace}/src/invoice.ts`,
        recentFiles: [`${SEED_PROJECTS.api.workspace}/src/invoice.ts`],
        cursorLine: 88,
        hasGitDiff: true,
      },
    },
    {
      id: 'g2-3',
      type: 'search',
      source: 'browser',
      ts: 1_700_000_120_000,
      payload: {
        browser: 'chrome',
        engine: 'google',
        query: 'stripe invoice line items rounding',
        url: 'https://www.google.com/search?q=stripe+invoice+line+items+rounding',
      },
    },
    {
      id: 'g2-4',
      type: 'browser_tab',
      source: 'browser',
      ts: 1_700_000_180_000,
      payload: {
        browser: 'chrome',
        url: 'https://docs.stripe.com/api/invoices',
        title: 'Invoices | Stripe API',
        active: true,
      },
    },
  ],
  expected: {
    summaryMustContain: ['Stripe', '인보이스'],
    summaryInferencePhrases: ['아마', '거예요'],
    evidenceMustContain: ['invoice.ts'],
    expectedActions: STANDARD_ACTIONS,
  },
};

/**
 * Case 3 — a research-only session (browsing + searching, no file edits).
 * Intent should still infer a goal, not list activity.
 */
const caseResearchOnly: GoldenCase = {
  id: 'research-only',
  description: '파일 편집 없이 React Server Components를 조사만 하던 상황.',
  timeline: [
    {
      id: 'g3-1',
      type: 'app_switch',
      source: 'app',
      ts: 1_700_100_000_000,
      payload: { appName: 'Safari', windowTitle: 'React 공식 문서' },
    },
    {
      id: 'g3-2',
      type: 'search',
      source: 'browser',
      ts: 1_700_100_060_000,
      payload: {
        browser: 'safari',
        engine: 'google',
        query: 'react server components data fetching',
        url: 'https://www.google.com/search?q=react+server+components+data+fetching',
      },
    },
    {
      id: 'g3-3',
      type: 'browser_tab',
      source: 'browser',
      ts: 1_700_100_120_000,
      payload: {
        browser: 'safari',
        url: 'https://react.dev/reference/rsc/server-components',
        title: 'Server Components – React',
        active: true,
      },
    },
    {
      id: 'g3-4',
      type: 'browser_tab',
      source: 'browser',
      ts: 1_700_100_240_000,
      payload: {
        browser: 'safari',
        url: 'https://react.dev/reference/rsc/use-server',
        title: 'use server – React',
        active: true,
      },
    },
  ],
  expected: {
    summaryMustContain: ['React'],
    summaryInferencePhrases: ['아마', '거예요'],
    evidenceMustContain: ['검색'],
    expectedActions: [
      { label: '관련 탭 열기', kind: 'open_tabs' },
      { label: '타임라인 보기', kind: 'show_timeline' },
    ],
  },
};

/**
 * Case 4 — a context switch: the developer jumped between two projects. The
 * intent should anchor to the most recent (post-gap) cluster.
 */
const caseContextSwitch: GoldenCase = {
  id: 'project-context-switch',
  description:
    'billing-api 작업 중 휴식 후 analytics-dashboard로 전환한 상황 — 최근 클러스터에 의도가 앵커되어야 함.',
  timeline: createSeedTimeline({ endTs: 1_700_200_000_000 }),
  expected: {
    summaryMustContain: ['Chart.js'],
    summaryInferencePhrases: ['이후에', '거예요'],
    evidenceMustContain: ['QueueChart.tsx'],
    expectedActions: STANDARD_ACTIONS,
  },
};

/** All golden cases (plan AC #9 — 3-5 cases). */
export const GOLDEN_CASES: readonly GoldenCase[] = [
  caseChartAnnotation,
  caseStripeInvoice,
  caseResearchOnly,
  caseContextSwitch,
];
