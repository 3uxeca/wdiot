import { describe, it, expect } from 'vitest';
import type { Activity, ContextWindow, ResumeAction } from '@wdiot/shared';
import {
  validateAction,
  validateActions,
  MAX_OPEN_TABS,
  EMPTY_ACTION_TOOLTIP,
} from './validators.js';

const WS = '/Users/dev/code/proj';

function windowWith(activities: Activity[]): ContextWindow {
  return { rangeMinutes: 30, assembledAt: 1_700_000_000_000, activities };
}

function browserTab(url: string): Activity {
  return {
    id: `tab-${url}`,
    type: 'browser_tab',
    source: 'browser',
    ts: 1000,
    payload: { browser: 'chrome', url, title: url, active: true },
  };
}

function fileEdit(filePath: string, recentFiles: string[] = []): Activity {
  return {
    id: `fe-${filePath}`,
    type: 'file_edit',
    source: 'ide',
    ts: 1000,
    projectId: 'p',
    payload: { workspacePath: WS, filePath, recentFiles, cursorLine: 1, hasGitDiff: true },
  };
}

const openTabs = (urls: string[]): ResumeAction => ({
  label: '관련 탭 열기',
  kind: 'open_tabs',
  payload: { urls },
});

const resumeWork = (payload: Record<string, unknown>): ResumeAction => ({
  label: '작업 이어가기',
  kind: 'resume_work',
  payload,
});

describe('validateAction — open_tabs URL scheme allowlist', () => {
  it('rejects javascript: URLs (dropped, not present in window anyway)', () => {
    const window = windowWith([browserTab('https://safe.com')]);
    const result = validateAction(
      openTabs(['javascript:alert(1)', 'https://safe.com']),
      window,
    );
    const urls = result.action.payload['urls'] as string[];
    expect(urls).toEqual(['https://safe.com']);
    expect(urls).not.toContain('javascript:alert(1)');
  });

  it('rejects file: and data: schemes', () => {
    const window = windowWith([
      browserTab('https://ok.com'),
      // craft window entries so the malicious URLs are "captured" — still dropped by scheme.
      browserTab('file:///etc/passwd'),
      browserTab('data:text/html,<script>'),
    ]);
    const result = validateAction(
      openTabs(['file:///etc/passwd', 'data:text/html,<script>', 'https://ok.com']),
      window,
    );
    expect(result.action.payload['urls']).toEqual(['https://ok.com']);
  });
});

describe('validateAction — open_tabs cross-check against ContextWindow', () => {
  it('drops URLs that were not captured in the window', () => {
    const window = windowWith([browserTab('https://captured.com')]);
    const result = validateAction(
      openTabs(['https://captured.com', 'https://not-captured.com']),
      window,
    );
    expect(result.action.payload['urls']).toEqual(['https://captured.com']);
    expect(result.enabled).toBe(true);
  });

  it('disables the action with a Korean tooltip when all URLs are dropped', () => {
    const window = windowWith([browserTab('https://captured.com')]);
    const result = validateAction(openTabs(['https://elsewhere.com']), window);
    expect(result.enabled).toBe(false);
    expect(result.disabledTooltip).toBe(EMPTY_ACTION_TOOLTIP);
    expect(result.action.payload['urls']).toEqual([]);
  });
});

describe('validateAction — open_tabs tab count cap', () => {
  it('caps open_tabs at 10 and reports truncation in Korean', () => {
    const urls = Array.from({ length: 14 }, (_, i) => `https://site-${i}.com`);
    const window = windowWith(urls.map(browserTab));
    const result = validateAction(openTabs(urls), window);

    expect((result.action.payload['urls'] as string[]).length).toBe(MAX_OPEN_TABS);
    expect(result.truncationNote).toBe('(14개 중 10개)');
    expect(result.enabled).toBe(true);
  });

  it('does not set a truncation note when within the cap', () => {
    const urls = ['https://a.com', 'https://b.com'];
    const window = windowWith(urls.map(browserTab));
    const result = validateAction(openTabs(urls), window);
    expect(result.truncationNote).toBeUndefined();
  });
});

describe('validateAction — resume_work path cross-check', () => {
  it('keeps file paths present in the window and drops others', () => {
    const window = windowWith([fileEdit(`${WS}/src/a.ts`)]);
    const result = validateAction(
      resumeWork({ paths: [`${WS}/src/a.ts`, `${WS}/src/ghost.ts`] }),
      window,
    );
    expect(result.action.payload['paths']).toEqual([`${WS}/src/a.ts`]);
    expect(result.enabled).toBe(true);
  });

  it('keeps a workspacePath captured via file_edit', () => {
    const window = windowWith([fileEdit(`${WS}/src/a.ts`)]);
    const result = validateAction(resumeWork({ workspacePath: WS }), window);
    expect(result.enabled).toBe(true);
    expect(result.action.payload['workspacePath']).toBe(WS);
  });

  it('cross-checks against recentFiles too', () => {
    const recent = `${WS}/src/recent.ts`;
    const window = windowWith([fileEdit(`${WS}/src/a.ts`, [recent])]);
    const result = validateAction(resumeWork({ paths: [recent] }), window);
    expect(result.action.payload['paths']).toEqual([recent]);
  });

  it('disables resume_work with a Korean tooltip when nothing matches', () => {
    const window = windowWith([fileEdit(`${WS}/src/a.ts`)]);
    const result = validateAction(
      resumeWork({ paths: ['/somewhere/else.ts'], workspacePath: '/other' }),
      window,
    );
    expect(result.enabled).toBe(false);
    expect(result.disabledTooltip).toBe(EMPTY_ACTION_TOOLTIP);
  });
});

describe('validateAction — show_timeline', () => {
  it('is always enabled with no payload mutation', () => {
    const action: ResumeAction = {
      label: '타임라인 보기',
      kind: 'show_timeline',
      payload: {},
    };
    const result = validateAction(action, windowWith([]));
    expect(result.enabled).toBe(true);
    expect(result.action).toBe(action);
  });
});

describe('validateActions', () => {
  it('validates a list of actions against one window', () => {
    const window = windowWith([browserTab('https://a.com'), fileEdit(`${WS}/src/a.ts`)]);
    const results = validateActions(
      [
        openTabs(['https://a.com']),
        resumeWork({ paths: [`${WS}/src/a.ts`] }),
        { label: '타임라인 보기', kind: 'show_timeline', payload: {} },
      ],
      window,
    );
    expect(results).toHaveLength(3);
    expect(results.every((r) => r.enabled)).toBe(true);
  });
});
