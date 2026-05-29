/**
 * AppleScript template registry.
 *
 * The `.applescript` files in this directory are the canonical script source.
 * They are imported as raw strings (Vite `?raw`) so they survive bundling into
 * the Electron main bundle — the same pattern as `storage/migrations`.
 *
 * Keep AppleScript isolated here + behind `applescript.ts` so browser/OS
 * version drift is a single-file fix (plan Risks — "AppleScript fragility").
 */
import activeAppScript from './active-app.applescript?raw';
import chromeTabsScript from './chrome-tabs.applescript?raw';
import safariTabsScript from './safari-tabs.applescript?raw';

/** Reads the frontmost app + window title via System Events (Accessibility). */
export const ACTIVE_APP_SCRIPT: string = activeAppScript;

/** Enumerates Google Chrome tabs (Automation permission). */
export const CHROME_TABS_SCRIPT: string = chromeTabsScript;

/** Enumerates Safari tabs (Automation permission). */
export const SAFARI_TABS_SCRIPT: string = safariTabsScript;

/**
 * Field separator emitted by the AppleScript templates — U+001F unit
 * separator. Chosen because it cannot appear in a URL or window title.
 */
export const FIELD_SEPARATOR = '';
