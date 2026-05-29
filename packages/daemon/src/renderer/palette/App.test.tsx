// @vitest-environment jsdom
/**
 * Palette two-phase paint tests (plan Work Unit E verification).
 *
 * Covers:
 *  - phase 1: EvidenceList paints from the local digest + IntentLine shows the
 *    "생각하는 중..." placeholder + ResumeActions render skeletons;
 *  - phase 2: a `palette:intent` push fills the IntentLine and renders buttons;
 *  - error: a failed `palette:intent` shows the "다시 시도" retry while keeping
 *    the phase-1 evidence visible.
 *
 * Uses only core `@testing-library` queries — no jest-dom matchers — so no
 * extra test dependency is required.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import type { ContextDigest, IntentResult } from '@wdiot/shared';
import type { PaletteIntentPush } from '../../ipc/contract.js';
import { App } from './App.js';

/** A small, valid local digest for the phase-1 paint. */
function makeDigest(): ContextDigest {
  const now = Date.now();
  return {
    rangeMinutes: 30,
    assembledAt: now,
    apps: [{ appName: 'Cursor', from: now - 600_000, to: now }],
    browser: [],
    searches: [
      {
        browser: 'chrome',
        engine: 'Google',
        query: 'chartjs annotation zoom',
        url: 'https://www.google.com/search?q=chartjs+annotation+zoom',
        ts: now - 300_000,
      },
    ],
    files: [
      {
        workspacePath: '/Users/me/proj',
        filePath: 'src/QueueChart.tsx',
        editCount: 3,
        hasGitDiff: true,
      },
    ],
    truncated: false,
  };
}

/** A valid phase-2 LLM result. */
function makeIntentResult(): IntentResult {
  return {
    intent: {
      summary: '아마 Chart.js 주석 버그를 고치고 있었을 거예요, 줌 코드를 본 이후에.',
      confidence: 0.8,
    },
    evidence: ['QueueChart.tsx를 수정했어요'],
    actions: [
      { label: '작업 이어가기', kind: 'resume_work', payload: {} },
      { label: '관련 탭 열기', kind: 'open_tabs', payload: {} },
      { label: '타임라인 보기', kind: 'show_timeline', payload: {} },
    ],
  };
}

/**
 * Install a fake `window.wdiot`. Returns a handle to manually drive the
 * phase-2 `palette:intent` push.
 */
function installBridge(opts: {
  digest: ContextDigest;
}): { push: (p: PaletteIntentPush) => void; requestId: string } {
  const requestId = 'req-test-1';
  let listener: ((p: PaletteIntentPush) => void) | null = null;

  const wdiot = {
    appName: 'WDIOT',
    invoke: vi.fn(async () => ({ requestId, digest: opts.digest })),
    onIntent: vi.fn((cb: (p: PaletteIntentPush) => void) => {
      listener = cb;
      return () => {
        listener = null;
      };
    }),
    runAction: vi.fn(async () => ({ ok: true })),
  };

  Object.defineProperty(window, 'wdiot', {
    value: wdiot,
    configurable: true,
    writable: true,
  });

  return {
    requestId,
    push: (p: PaletteIntentPush) => listener?.(p),
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('palette two-phase paint', () => {
  it('phase 1: paints EvidenceList from the local digest and shows the "생각하는 중..." placeholder', async () => {
    installBridge({ digest: makeDigest() });
    render(<App />);

    // IntentLine shows the Korean thinking placeholder.
    const thinking = await screen.findByTestId('intent-thinking');
    expect(thinking.textContent).toContain('생각하는 중...');

    // EvidenceList is painted with locally-derived bullets.
    const evidence = await screen.findByTestId('evidence-list');
    expect(evidence.textContent).toContain('최근 활동:');
    expect(evidence.textContent).toContain('QueueChart.tsx를 수정했어요');
    expect(evidence.textContent).toContain(
      "'chartjs annotation zoom'을 검색했어요",
    );

    // ResumeActions render skeleton placeholders, not real buttons yet.
    expect(screen.getByTestId('resume-actions-skeleton')).toBeTruthy();
    expect(screen.queryByTestId('resume-actions')).toBeNull();
  });

  it('phase 2: a palette:intent push fills the IntentLine and renders real action buttons', async () => {
    const bridge = installBridge({ digest: makeDigest() });
    render(<App />);

    // Wait for phase 1 to settle.
    await screen.findByTestId('intent-thinking');

    // Drive the phase-2 push.
    bridge.push({
      requestId: bridge.requestId,
      ok: true,
      result: makeIntentResult(),
    });

    // IntentLine is now filled with the inferred Korean sentence.
    await waitFor(() => {
      expect(screen.getByTestId('intent-line').textContent).toContain(
        '아마 Chart.js 주석 버그를 고치고 있었을 거예요',
      );
    });
    expect(screen.queryByTestId('intent-thinking')).toBeNull();

    // Real action buttons appear with Korean labels.
    expect(screen.getByTestId('resume-actions')).toBeTruthy();
    expect(screen.getByTestId('action-resume_work').textContent).toContain(
      '작업 이어가기',
    );
    expect(screen.getByTestId('action-open_tabs').textContent).toContain(
      '관련 탭 열기',
    );
    expect(screen.getByTestId('action-show_timeline').textContent).toContain(
      '타임라인 보기',
    );
  });

  it('error: a failed palette:intent shows the "다시 시도" retry while keeping phase-1 evidence', async () => {
    const bridge = installBridge({ digest: makeDigest() });
    render(<App />);

    await screen.findByTestId('intent-thinking');

    // Drive a phase-2 failure.
    bridge.push({
      requestId: bridge.requestId,
      ok: false,
      error: 'LLM 호출에 실패했습니다.',
    });

    // Error banner with the Korean retry button.
    const retry = await screen.findByTestId('palette-retry');
    expect(retry.textContent).toContain('다시 시도');
    expect(screen.getByTestId('palette-error').textContent).toContain(
      '의도를 분석하지 못했어요.',
    );

    // Phase-1 evidence stays visible under the error.
    expect(screen.getByTestId('evidence-list').textContent).toContain(
      'QueueChart.tsx를 수정했어요',
    );
  });
});
