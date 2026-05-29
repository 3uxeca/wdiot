import { describe, it, expect } from 'vitest';
import { IntentResultSchema, ContextDigestSchema } from './context.js';

describe('IntentResultSchema', () => {
  const validResult = {
    intent: {
      summary: '아마 Chart.js 주석 오프셋 버그를 고치고 있었을 거예요, 줌 코드를 확인한 이후에.',
      confidence: 0.85,
    },
    evidence: ['QueueChart.tsx를 수정했어요', "'chartjs annotation zoom'을 검색했어요"],
    actions: [
      { label: '관련 탭 열기', kind: 'open_tabs', payload: {} },
      { label: '타임라인 보기', kind: 'show_timeline', payload: {} },
    ],
  };

  it('accepts a valid IntentResult', () => {
    expect(IntentResultSchema.safeParse(validResult).success).toBe(true);
  });

  it('rejects an empty intent.summary', () => {
    const result = IntentResultSchema.safeParse({
      ...validResult,
      intent: { summary: '', confidence: 0.5 },
    });
    expect(result.success).toBe(false);
  });

  it('rejects a missing intent.summary', () => {
    const result = IntentResultSchema.safeParse({
      ...validResult,
      intent: { confidence: 0.5 },
    });
    expect(result.success).toBe(false);
  });

  it('rejects a confidence outside 0..1', () => {
    const result = IntentResultSchema.safeParse({
      ...validResult,
      intent: { summary: '의도 요약', confidence: 1.7 },
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown action kind', () => {
    const result = IntentResultSchema.safeParse({
      ...validResult,
      actions: [{ label: '실행', kind: 'delete_files', payload: {} }],
    });
    expect(result.success).toBe(false);
  });
});

describe('ContextDigestSchema', () => {
  it('accepts a minimal empty digest', () => {
    const digest = {
      rangeMinutes: 30,
      assembledAt: 1_700_000_000_000,
      apps: [],
      browser: [],
      searches: [],
      files: [],
      truncated: false,
    };
    expect(ContextDigestSchema.safeParse(digest).success).toBe(true);
  });

  it('rejects a non-positive rangeMinutes', () => {
    const digest = {
      rangeMinutes: 0,
      assembledAt: 1,
      apps: [],
      browser: [],
      searches: [],
      files: [],
      truncated: false,
    };
    expect(ContextDigestSchema.safeParse(digest).success).toBe(false);
  });
});
