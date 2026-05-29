import { describe, it, expect, vi } from 'vitest';
import type { Activity, ContextWindow, ResumeAction } from '@wdiot/shared';
import { runAction } from './executor.js';

const NOW = 1_700_000_000_000;
const WS = '/Users/dev/code/wdiot';

function windowWith(activities: Activity[]): ContextWindow {
  return { rangeMinutes: 30, assembledAt: NOW, activities };
}

function tab(url: string, ts: number): Activity {
  return {
    id: `tab-${ts}`,
    type: 'browser_tab',
    source: 'browser',
    ts,
    payload: { browser: 'chrome', url, title: url, active: true },
  };
}

function search(url: string, ts: number): Activity {
  return {
    id: `search-${ts}`,
    type: 'search',
    source: 'browser',
    ts,
    payload: { browser: 'chrome', engine: 'Google', query: 'wdiot', url },
  };
}

function file(filePath: string, ts: number): Activity {
  return {
    id: `file-${ts}`,
    type: 'file_edit',
    source: 'ide',
    ts,
    projectId: 'p',
    payload: {
      workspacePath: WS,
      filePath,
      recentFiles: [],
      cursorLine: 12,
      hasGitDiff: true,
    },
  };
}

describe('runAction', () => {
  it('hydrates an empty open_tabs payload from captured browser/search URLs', async () => {
    const openExternal = vi.fn(async () => undefined);
    const action: ResumeAction = {
      label: '관련 탭 열기',
      kind: 'open_tabs',
      payload: {},
    };

    const result = await runAction(
      action,
      windowWith([
        tab('https://older.example', 1),
        search('https://google.com/search?q=wdiot', 2),
        tab('https://newer.example', 3),
      ]),
      { openTimeline: vi.fn(), openExternal },
    );

    expect(result.ok).toBe(true);
    expect(openExternal).toHaveBeenCalledWith('https://newer.example');
    expect(openExternal).toHaveBeenCalledWith('https://google.com/search?q=wdiot');
    expect(openExternal).toHaveBeenCalledWith('https://older.example');
  });

  it('hydrates an empty resume_work payload and opens the workspace via openPath', async () => {
    const openPath = vi.fn(async () => '');
    const action: ResumeAction = {
      label: '작업 이어가기',
      kind: 'resume_work',
      payload: {},
    };

    const result = await runAction(action, windowWith([file(`${WS}/src/index.ts`, 1)]), {
      openTimeline: vi.fn(),
      openPath,
    });

    expect(result.ok).toBe(true);
    expect(openPath).toHaveBeenCalledWith(WS);
  });

  it('keeps show_timeline scoped to the captured window range', async () => {
    const openTimeline = vi.fn();
    const action: ResumeAction = {
      label: '타임라인 보기',
      kind: 'show_timeline',
      payload: {},
    };

    const result = await runAction(
      action,
      windowWith([tab('https://example.com', 100), tab('https://later.example', 200)]),
      { openTimeline },
    );

    expect(result.ok).toBe(true);
    expect(openTimeline).toHaveBeenCalledWith({ from: 100, to: NOW });
  });
});
