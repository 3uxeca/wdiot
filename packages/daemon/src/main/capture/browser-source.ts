/**
 * Browser capture source — plan B2 ("browser-source").
 *
 * Enumerates Chrome and Safari tabs via `osascript` and produces:
 *   - `browser_tab` Activities for each open tab, and
 *   - `search` Activities parsed out of search-engine URLs.
 *
 * Chrome and Safari have **independent** macOS Automation grants, so each is
 * polled and health-tracked separately (plan B2 "partial-grant awareness").
 * A `BrowserPollResult` reports per-browser outcome to the scheduler, which
 * forwards it to the health state machine.
 */
import { randomUUID } from 'node:crypto';
import type { BrowserTabActivity, SearchActivity, SupportedBrowser } from '@wdiot/shared';
import { runOsascript, OsascriptError, type OsascriptFailureKind } from './applescript.js';
import { CHROME_TABS_SCRIPT, SAFARI_TABS_SCRIPT, FIELD_SEPARATOR } from './scripts/index.js';

/** A single tab as read from a browser. */
export interface BrowserTab {
  browser: SupportedBrowser;
  url: string;
  title: string;
  active: boolean;
}

/** A search parsed out of a tab URL. */
export interface ParsedSearch {
  engine: string;
  query: string;
}

/** The AppleScript template per supported browser. */
const BROWSER_SCRIPT: Record<SupportedBrowser, string> = {
  chrome: CHROME_TABS_SCRIPT,
  safari: SAFARI_TABS_SCRIPT,
};

// --- search-engine URL parsing --------------------------------------------

/**
 * Search engines WDIOT recognizes, by hostname suffix. Each entry names the
 * query parameter that carries the search term. Kept deliberately small —
 * the plan's Non-Goals scope capture to what is listed.
 */
const SEARCH_ENGINES: ReadonlyArray<{
  /** Lower-cased hostname suffix match. */
  hostSuffix: string;
  /** Human-readable engine name stored on the `search` Activity. */
  engine: string;
  /** Query-string parameter holding the search term. */
  queryParam: string;
}> = [
  { hostSuffix: 'google.com', engine: 'Google', queryParam: 'q' },
  { hostSuffix: 'bing.com', engine: 'Bing', queryParam: 'q' },
  { hostSuffix: 'duckduckgo.com', engine: 'DuckDuckGo', queryParam: 'q' },
  { hostSuffix: 'search.yahoo.com', engine: 'Yahoo', queryParam: 'p' },
  { hostSuffix: 'search.naver.com', engine: 'Naver', queryParam: 'query' },
  { hostSuffix: 'search.daum.net', engine: 'Daum', queryParam: 'q' },
];

/**
 * Parse a search query out of a URL when it is a recognized search-engine
 * results page. Returns `undefined` for non-search URLs (or unparsable input).
 *
 * Exposed for unit testing — this is the one piece of `browser-source` that is
 * fully testable off a real desktop.
 */
export function parseSearchQuery(rawUrl: string): ParsedSearch | undefined {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;

  const host = url.hostname.toLowerCase();
  const engine = SEARCH_ENGINES.find(
    (e) => host === e.hostSuffix || host.endsWith('.' + e.hostSuffix),
  );
  if (!engine) return undefined;

  const query = url.searchParams.get(engine.queryParam);
  if (query === null) return undefined;
  const trimmed = query.trim();
  if (trimmed.length === 0) return undefined;

  return { engine: engine.engine, query: trimmed };
}

// --- AppleScript output parsing -------------------------------------------

/**
 * Parse the raw `osascript` tab-enumeration output into {@link BrowserTab}s.
 * Each line is `<winIdx>␟<tabIdx>␟<active 0|1>␟<url>␟<title>`. Lines without a
 * usable `http(s)` URL are skipped (e.g. `chrome://`, `about:`, blank tabs).
 */
export function parseTabLines(browser: SupportedBrowser, raw: string): BrowserTab[] {
  if (raw.trim().length === 0) return [];
  const tabs: BrowserTab[] = [];
  for (const line of raw.split('\n')) {
    if (line.length === 0) continue;
    const fields = line.split(FIELD_SEPARATOR);
    if (fields.length < 5) continue;
    const active = fields[2] === '1';
    const url = (fields[3] ?? '').trim();
    const title = (fields[4] ?? '').trim();
    // Only http(s) tabs are activity-worthy; internal pages carry no intent.
    if (!url.startsWith('http://') && !url.startsWith('https://')) continue;
    tabs.push({ browser, url, title, active });
  }
  return tabs;
}

// --- Activity factories ----------------------------------------------------

/** Build a `browser_tab` Activity from a {@link BrowserTab}. */
export function toBrowserTabActivity(
  tab: BrowserTab,
  ts: number = Date.now(),
): BrowserTabActivity {
  return {
    id: randomUUID(),
    type: 'browser_tab',
    source: 'browser',
    ts,
    payload: {
      browser: tab.browser,
      url: tab.url,
      title: tab.title,
      active: tab.active,
    },
  };
}

/** Build a `search` Activity from a {@link BrowserTab} that is a search page. */
export function toSearchActivity(
  tab: BrowserTab,
  search: ParsedSearch,
  ts: number = Date.now(),
): SearchActivity {
  return {
    id: randomUUID(),
    type: 'search',
    source: 'browser',
    ts,
    payload: {
      browser: tab.browser,
      engine: search.engine,
      query: search.query,
      url: tab.url,
    },
  };
}

/**
 * Turn a list of tabs into Activities: one `browser_tab` per tab, plus one
 * `search` per tab whose URL is a recognized search-results page.
 */
export function tabsToActivities(
  tabs: readonly BrowserTab[],
  ts: number = Date.now(),
): Array<BrowserTabActivity | SearchActivity> {
  const activities: Array<BrowserTabActivity | SearchActivity> = [];
  for (const tab of tabs) {
    activities.push(toBrowserTabActivity(tab, ts));
    const search = parseSearchQuery(tab.url);
    if (search) activities.push(toSearchActivity(tab, search, ts));
  }
  return activities;
}

// --- polling ---------------------------------------------------------------

/** Outcome of polling a single browser. */
export type BrowserPollResult =
  | { browser: SupportedBrowser; ok: true; tabs: BrowserTab[] }
  | { browser: SupportedBrowser; ok: false; failure: OsascriptFailureKind; message: string };

/**
 * Poll one browser for its open tabs. Never throws — a failure is returned as
 * a structured {@link BrowserPollResult} so the scheduler can route Chrome and
 * Safari independently to their own health machines.
 */
export async function pollBrowser(
  browser: SupportedBrowser,
  signal?: AbortSignal,
): Promise<BrowserPollResult> {
  try {
    const raw = await runOsascript(BROWSER_SCRIPT[browser], { signal });
    return { browser, ok: true, tabs: parseTabLines(browser, raw) };
  } catch (err) {
    if (err instanceof OsascriptError) {
      return { browser, ok: false, failure: err.kind, message: err.message };
    }
    return {
      browser,
      ok: false,
      failure: 'error',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
