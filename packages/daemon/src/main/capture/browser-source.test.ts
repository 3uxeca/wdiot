import { describe, it, expect } from 'vitest';
import {
  parseSearchQuery,
  parseTabLines,
  tabsToActivities,
  type BrowserTab,
} from './browser-source.js';
import { FIELD_SEPARATOR } from './scripts/index.js';

describe('parseSearchQuery — search-engine URL parsing', () => {
  it('parses a Google search query', () => {
    expect(parseSearchQuery('https://www.google.com/search?q=chartjs+annotation+zoom')).toEqual(
      { engine: 'Google', query: 'chartjs annotation zoom' },
    );
  });

  it('parses a Bing search query', () => {
    expect(parseSearchQuery('https://www.bing.com/search?q=typescript+generics')).toEqual({
      engine: 'Bing',
      query: 'typescript generics',
    });
  });

  it('parses a DuckDuckGo search query', () => {
    expect(parseSearchQuery('https://duckduckgo.com/?q=rust+borrow+checker')).toEqual({
      engine: 'DuckDuckGo',
      query: 'rust borrow checker',
    });
  });

  it('parses a Yahoo search query (p parameter)', () => {
    expect(parseSearchQuery('https://search.yahoo.com/search?p=node+streams')).toEqual({
      engine: 'Yahoo',
      query: 'node streams',
    });
  });

  it('parses a Naver search query (query parameter, Korean term)', () => {
    expect(
      parseSearchQuery('https://search.naver.com/search.naver?query=' + encodeURIComponent('리액트 훅')),
    ).toEqual({ engine: 'Naver', query: '리액트 훅' });
  });

  it('parses a Daum search query', () => {
    expect(parseSearchQuery('https://search.daum.net/search?q=swift+optionals')).toEqual({
      engine: 'Daum',
      query: 'swift optionals',
    });
  });

  it('matches a search subdomain via host suffix', () => {
    expect(
      parseSearchQuery('https://www.google.co.kr/search?q=hello')?.engine,
    ).toBe(undefined); // google.co.kr is a different suffix — not registered
    expect(parseSearchQuery('https://news.google.com/search?q=hello')).toEqual({
      engine: 'Google',
      query: 'hello',
    });
  });

  it('returns undefined for a non-search URL on a known host', () => {
    expect(parseSearchQuery('https://www.google.com/maps')).toBeUndefined();
  });

  it('returns undefined for an unrelated site', () => {
    expect(parseSearchQuery('https://github.com/owner/repo')).toBeUndefined();
  });

  it('returns undefined for a blank query parameter', () => {
    expect(parseSearchQuery('https://www.google.com/search?q=')).toBeUndefined();
    expect(parseSearchQuery('https://www.google.com/search?q=%20%20')).toBeUndefined();
  });

  it('returns undefined for a non-http(s) scheme', () => {
    expect(parseSearchQuery('chrome://settings')).toBeUndefined();
    expect(parseSearchQuery('javascript:alert(1)')).toBeUndefined();
  });

  it('returns undefined for an unparsable URL', () => {
    expect(parseSearchQuery('not a url')).toBeUndefined();
    expect(parseSearchQuery('')).toBeUndefined();
  });

  it('decodes a multi-word query with extra params present', () => {
    expect(
      parseSearchQuery('https://www.google.com/search?hl=en&q=electron+globalShortcut&safe=off'),
    ).toEqual({ engine: 'Google', query: 'electron globalShortcut' });
  });
});

describe('parseTabLines — osascript output parsing', () => {
  const sep = FIELD_SEPARATOR;
  const line = (w: number, t: number, active: string, url: string, title: string): string =>
    [w, t, active, url, title].join(sep);

  it('parses multiple tabs with the unit separator', () => {
    const raw = [
      line(1, 1, '1', 'https://example.com/', 'Example'),
      line(1, 2, '0', 'https://github.com/x/y', 'GitHub'),
    ].join('\n');
    const tabs = parseTabLines('chrome', raw);
    expect(tabs).toEqual([
      { browser: 'chrome', url: 'https://example.com/', title: 'Example', active: true },
      { browser: 'chrome', url: 'https://github.com/x/y', title: 'GitHub', active: false },
    ]);
  });

  it('returns an empty array for empty output (browser not running)', () => {
    expect(parseTabLines('safari', '')).toEqual([]);
    expect(parseTabLines('safari', '   ')).toEqual([]);
  });

  it('skips internal-page tabs (chrome://, about:)', () => {
    const raw = [
      line(1, 1, '1', 'chrome://settings', 'Settings'),
      line(1, 2, '0', 'about:blank', 'New Tab'),
      line(1, 3, '0', 'https://real.example/', 'Real'),
    ].join('\n');
    const tabs = parseTabLines('chrome', raw);
    expect(tabs).toHaveLength(1);
    expect(tabs[0]?.url).toBe('https://real.example/');
  });

  it('tolerates titles/urls — separator is unit-separator, not a printable char', () => {
    const raw = line(2, 5, '1', 'https://x.test/path?a=1', 'A | B — title');
    const tabs = parseTabLines('safari', raw);
    expect(tabs[0]?.title).toBe('A | B — title');
  });

  it('skips malformed lines with too few fields', () => {
    const raw = ['1' + sep + '2', line(1, 3, '0', 'https://ok.test/', 'OK')].join('\n');
    expect(parseTabLines('chrome', raw)).toHaveLength(1);
  });
});

describe('tabsToActivities', () => {
  it('emits one browser_tab per tab and a search for search-engine tabs', () => {
    const tabs: BrowserTab[] = [
      { browser: 'chrome', url: 'https://github.com/x/y', title: 'GitHub', active: false },
      {
        browser: 'chrome',
        url: 'https://www.google.com/search?q=chartjs+zoom',
        title: 'chartjs zoom - Google',
        active: true,
      },
    ];
    const activities = tabsToActivities(tabs, 1_700_000_000_000);

    const types = activities.map((a) => a.type);
    expect(types).toEqual(['browser_tab', 'browser_tab', 'search']);

    const search = activities.find((a) => a.type === 'search');
    expect(search?.type === 'search' && search.payload).toEqual({
      browser: 'chrome',
      engine: 'Google',
      query: 'chartjs zoom',
      url: 'https://www.google.com/search?q=chartjs+zoom',
    });
  });

  it('stamps every activity with the supplied timestamp', () => {
    const tabs: BrowserTab[] = [
      { browser: 'safari', url: 'https://a.test/', title: 'A', active: true },
    ];
    const [activity] = tabsToActivities(tabs, 12345);
    expect(activity?.ts).toBe(12345);
    expect(activity?.source).toBe('browser');
  });

  it('produces no search activity when no tab is a search page', () => {
    const tabs: BrowserTab[] = [
      { browser: 'chrome', url: 'https://docs.example/', title: 'Docs', active: true },
    ];
    expect(tabsToActivities(tabs).some((a) => a.type === 'search')).toBe(false);
  });
});
