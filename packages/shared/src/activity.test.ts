import { describe, it, expect } from 'vitest';
import {
  ActivitySchema,
  AppSwitchActivitySchema,
  BrowserTabActivitySchema,
  FileEditActivitySchema,
  SearchActivitySchema,
  safeParseActivity,
} from './activity.js';

describe('ActivitySchema — valid variants', () => {
  it('accepts a valid app_switch activity', () => {
    const value = {
      id: 'a1',
      type: 'app_switch',
      source: 'app',
      ts: 1_700_000_000_000,
      payload: { appName: 'Cursor', bundleId: 'com.todesktop.230313mzl4w4u92', windowTitle: 'index.ts' },
    };
    expect(ActivitySchema.safeParse(value).success).toBe(true);
    expect(AppSwitchActivitySchema.safeParse(value).success).toBe(true);
  });

  it('accepts a valid browser_tab activity', () => {
    const value = {
      id: 'b1',
      type: 'browser_tab',
      source: 'browser',
      ts: 1_700_000_001_000,
      payload: {
        browser: 'chrome',
        url: 'https://example.com/docs',
        title: 'Docs',
        active: true,
      },
    };
    expect(ActivitySchema.safeParse(value).success).toBe(true);
    expect(BrowserTabActivitySchema.safeParse(value).success).toBe(true);
  });

  it('accepts a valid file_edit activity with projectId', () => {
    const value = {
      id: 'f1',
      type: 'file_edit',
      source: 'ide',
      ts: 1_700_000_002_000,
      projectId: 'proj-1',
      payload: {
        workspacePath: '/Users/me/code/wdiot',
        filePath: '/Users/me/code/wdiot/src/index.ts',
        recentFiles: ['/Users/me/code/wdiot/src/a.ts'],
        cursorLine: 42,
        selectionText: 'const x = 1;',
        hasGitDiff: true,
      },
    };
    expect(ActivitySchema.safeParse(value).success).toBe(true);
    expect(FileEditActivitySchema.safeParse(value).success).toBe(true);
  });

  it('accepts a valid search activity', () => {
    const value = {
      id: 's1',
      type: 'search',
      source: 'browser',
      ts: 1_700_000_003_000,
      payload: {
        browser: 'safari',
        engine: 'google',
        query: 'chartjs annotation zoom',
        url: 'https://www.google.com/search?q=chartjs+annotation+zoom',
      },
    };
    expect(ActivitySchema.safeParse(value).success).toBe(true);
    expect(SearchActivitySchema.safeParse(value).success).toBe(true);
  });
});

describe('ActivitySchema — invalid variants', () => {
  it('rejects an unknown type', () => {
    const result = safeParseActivity({
      id: 'x',
      type: 'mouse_move',
      source: 'app',
      ts: 1,
      payload: {},
    });
    expect(result.success).toBe(false);
  });

  it('rejects app_switch missing appName', () => {
    const result = safeParseActivity({
      id: 'x',
      type: 'app_switch',
      source: 'app',
      ts: 1,
      payload: { bundleId: 'com.example' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects browser_tab with a non-URL url', () => {
    const result = safeParseActivity({
      id: 'x',
      type: 'browser_tab',
      source: 'browser',
      ts: 1,
      payload: { browser: 'chrome', url: 'not a url', title: 't', active: true },
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unsupported browser', () => {
    const result = safeParseActivity({
      id: 'x',
      type: 'browser_tab',
      source: 'browser',
      ts: 1,
      payload: { browser: 'firefox', url: 'https://x.com', title: 't', active: true },
    });
    expect(result.success).toBe(false);
  });

  it('rejects file_edit missing hasGitDiff', () => {
    const result = safeParseActivity({
      id: 'x',
      type: 'file_edit',
      source: 'ide',
      ts: 1,
      payload: { workspacePath: '/a', filePath: '/a/b.ts' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects a negative ts', () => {
    const result = safeParseActivity({
      id: 'x',
      type: 'app_switch',
      source: 'app',
      ts: -1,
      payload: { appName: 'Cursor' },
    });
    expect(result.success).toBe(false);
  });
});
