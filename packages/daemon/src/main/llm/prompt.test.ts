import { describe, it, expect } from 'vitest';
import type { ContextWindow } from '@wdiot/shared';
import { KOREAN_OUTPUT_DIRECTIVE, LlmResponseSchema } from '@wdiot/shared';
import { buildPrompt, SYSTEM_PROMPT } from './prompt.js';
import { parseIntentResult } from './parse-response.js';
import { compressContextWindow } from '../context/compressor.js';
import { assembleContextWindow } from '../context/assembler.js';
import { openDatabase } from '../storage/db.js';
import { insertActivities } from '../storage/activity-repo.js';
import { createSeedTimeline, SEED_END_TS } from '../context/__fixtures__/seed-timeline.js';
import { seedProjects } from '../context/__fixtures__/seed-projects.js';
import { GOLDEN_CASES } from '../context/__fixtures__/golden-cases.js';

/** Build a digest from a timeline without touching the DB twice. */
async function digestFromTimeline(timeline: ReturnType<typeof createSeedTimeline>) {
  const db = openDatabase(':memory:');
  seedProjects(db);
  insertActivities(db, timeline);
  const lastTs = timeline.reduce((m, a) => Math.max(m, a.ts), 0);
  const window: ContextWindow = assembleContextWindow(db, {
    now: lastTs + 1,
    rangeMinutes: 24 * 60, // wide enough to cover any fixed-time golden timeline.
  });
  db.close();
  return compressContextWindow(window);
}

describe('SYSTEM_PROMPT', () => {
  it('contains the exact Korean-output directive (AC #9 / #12 gate)', () => {
    expect(SYSTEM_PROMPT).toContain(KOREAN_OUTPUT_DIRECTIVE);
    expect(SYSTEM_PROMPT).toContain('모든 텍스트 출력은 반드시 한국어로 작성하세요');
  });

  it('instructs the model to infer intent, not list activity', () => {
    expect(SYSTEM_PROMPT).toContain('의도를 추론');
    expect(SYSTEM_PROMPT).toContain('나열하지');
  });

  it('keeps the JSON keys English per the contract', () => {
    expect(SYSTEM_PROMPT).toContain('"intent"');
    expect(SYSTEM_PROMPT).toContain('"evidence"');
    expect(SYSTEM_PROMPT).toContain('"actions"');
  });
});

describe('buildPrompt', () => {
  it('emits a system + user pair with the digest in the user message', async () => {
    const db = openDatabase(':memory:');
    seedProjects(db);
    insertActivities(db, createSeedTimeline());
    const window = assembleContextWindow(db, { now: SEED_END_TS });
    db.close();

    const digest = await compressContextWindow(window);
    const prompt = buildPrompt(digest);

    expect(prompt.system).toBe(SYSTEM_PROMPT);
    expect(prompt.user).toContain('DIGEST START');
    expect(prompt.user).toContain('DIGEST END');
    // a known seeded file appears in the rendered digest.
    expect(prompt.user).toContain('QueueChart.tsx');
  });

  it('renders the gap annotation into the user message when present', async () => {
    const db = openDatabase(':memory:');
    seedProjects(db);
    insertActivities(db, createSeedTimeline());
    const window = assembleContextWindow(db, { now: SEED_END_TS });
    db.close();

    const digest = await compressContextWindow(window);
    const prompt = buildPrompt(digest);
    expect(digest.gapDetected).toBeDefined();
    expect(prompt.user).toContain('gap_detected');
  });
});

describe('golden cases — prompt shape per case', () => {
  for (const gc of GOLDEN_CASES) {
    it(`builds a digest-bearing prompt for "${gc.id}"`, async () => {
      const digest = await digestFromTimeline(gc.timeline);
      const prompt = buildPrompt(digest);

      expect(prompt.system).toContain(KOREAN_OUTPUT_DIRECTIVE);
      expect(prompt.user).toContain('DIGEST START');

      // each evidence substring the golden case expects must be derivable
      // from a digest section the prompt renders.
      for (const expected of gc.expected.evidenceMustContain) {
        // '검색' is a section label; file/url substrings appear in the digest body.
        if (expected === '검색') {
          expect(prompt.user).toContain('searches');
        } else {
          expect(prompt.user).toContain(expected);
        }
      }
    });
  }
});

describe('parseIntentResult — zod validation of a model response', () => {
  it('parses a well-formed Korean JSON response', () => {
    const raw = JSON.stringify({
      intent: {
        summary: '아마 Chart.js 주석 오프셋 버그를 고치고 있었을 거예요, 줌 코드를 확인한 이후에.',
        confidence: 0.85,
      },
      evidence: ['QueueChart.tsx를 수정했어요', 'chartOptions.ts를 확인했어요'],
      actions: [
        { label: '작업 이어가기', kind: 'resume_work', payload: {} },
        { label: '타임라인 보기', kind: 'show_timeline', payload: {} },
      ],
    });
    const result = parseIntentResult(raw);
    expect(LlmResponseSchema.safeParse(result).success).toBe(true);
    expect(result.intent.summary).toContain('Chart.js');
  });

  it('strips a ```json code fence before parsing', () => {
    const raw =
      '```json\n' +
      JSON.stringify({
        intent: { summary: '아마 작업 중이었을 거예요.', confidence: 0.5 },
        evidence: ['파일을 수정했어요'],
        actions: [{ label: '타임라인 보기', kind: 'show_timeline', payload: {} }],
      }) +
      '\n```';
    const result = parseIntentResult(raw);
    expect(result.intent.summary).toContain('작업');
  });

  it('throws on non-JSON text', () => {
    expect(() => parseIntentResult('sorry, I cannot help')).toThrow(/not valid JSON/);
  });

  it('throws when the response fails the schema (empty intent summary)', () => {
    const raw = JSON.stringify({
      intent: { summary: '', confidence: 0.5 },
      evidence: ['x'],
      actions: [],
    });
    expect(() => parseIntentResult(raw)).toThrow(/schema validation/);
  });

  it('throws when an action kind is not in the contract', () => {
    const raw = JSON.stringify({
      intent: { summary: '아마 작업 중이었을 거예요.', confidence: 0.5 },
      evidence: ['x'],
      actions: [{ label: '나쁜 동작', kind: 'delete_files', payload: {} }],
    });
    expect(() => parseIntentResult(raw)).toThrow(/schema validation/);
  });
});
