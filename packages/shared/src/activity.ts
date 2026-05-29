/**
 * Activity event schema — Boundary 4 of the WDIOT v1 plan.
 *
 * A single `activities` SQLite table stores all variants; the TypeScript layer
 * models them as a discriminated union keyed on `type`. Co-located zod schemas
 * validate the payloads at runtime boundaries (ingest HTTP, LLM response, tests).
 */
import { z } from 'zod';

export type ActivityType = 'app_switch' | 'browser_tab' | 'file_edit' | 'search';
export type ActivitySource = 'app' | 'browser' | 'ide';

/** Browsers WDIOT v1 captures. No browsers beyond Chrome/Safari (Non-Goal). */
export type SupportedBrowser = 'chrome' | 'safari';

export interface ActivityBase {
  /** uuid */
  id: string;
  type: ActivityType;
  source: ActivitySource;
  /** epoch ms (UTC) */
  ts: number;
  /** FK -> projects.id, set only on file_edit activities (see plan B4). */
  projectId?: string;
}

export interface AppSwitchActivity extends ActivityBase {
  type: 'app_switch';
  payload: { appName: string; bundleId?: string; windowTitle?: string };
}

export interface BrowserTabActivity extends ActivityBase {
  type: 'browser_tab';
  payload: { browser: SupportedBrowser; url: string; title: string; active: boolean };
}

export interface FileEditActivity extends ActivityBase {
  type: 'file_edit';
  payload: {
    workspacePath: string;
    filePath: string;
    recentFiles?: string[];
    cursorLine?: number;
    selectionText?: string;
    hasGitDiff: boolean;
  };
}

export interface SearchActivity extends ActivityBase {
  type: 'search';
  payload: { browser: SupportedBrowser; engine: string; query: string; url: string };
}

export type Activity =
  | AppSwitchActivity
  | BrowserTabActivity
  | FileEditActivity
  | SearchActivity;

// --- zod schemas -----------------------------------------------------------

export const ActivityTypeSchema = z.enum([
  'app_switch',
  'browser_tab',
  'file_edit',
  'search',
]);

export const ActivitySourceSchema = z.enum(['app', 'browser', 'ide']);

export const SupportedBrowserSchema = z.enum(['chrome', 'safari']);

export const AppSwitchPayloadSchema = z.object({
  appName: z.string().min(1),
  bundleId: z.string().optional(),
  windowTitle: z.string().optional(),
});

export const BrowserTabPayloadSchema = z.object({
  browser: SupportedBrowserSchema,
  url: z.string().url(),
  title: z.string(),
  active: z.boolean(),
});

export const FileEditPayloadSchema = z.object({
  workspacePath: z.string().min(1),
  filePath: z.string().min(1),
  recentFiles: z.array(z.string()).optional(),
  cursorLine: z.number().int().nonnegative().optional(),
  selectionText: z.string().optional(),
  hasGitDiff: z.boolean(),
});

export const SearchPayloadSchema = z.object({
  browser: SupportedBrowserSchema,
  engine: z.string().min(1),
  query: z.string().min(1),
  url: z.string().url(),
});

const activityBaseShape = {
  id: z.string().min(1),
  source: ActivitySourceSchema,
  ts: z.number().int().nonnegative(),
  projectId: z.string().min(1).optional(),
};

export const AppSwitchActivitySchema = z.object({
  ...activityBaseShape,
  type: z.literal('app_switch'),
  payload: AppSwitchPayloadSchema,
});

export const BrowserTabActivitySchema = z.object({
  ...activityBaseShape,
  type: z.literal('browser_tab'),
  payload: BrowserTabPayloadSchema,
});

export const FileEditActivitySchema = z.object({
  ...activityBaseShape,
  type: z.literal('file_edit'),
  payload: FileEditPayloadSchema,
});

export const SearchActivitySchema = z.object({
  ...activityBaseShape,
  type: z.literal('search'),
  payload: SearchPayloadSchema,
});

export const ActivitySchema = z.discriminatedUnion('type', [
  AppSwitchActivitySchema,
  BrowserTabActivitySchema,
  FileEditActivitySchema,
  SearchActivitySchema,
]);

/** Parse + validate an unknown value into an `Activity`. Throws on failure. */
export function parseActivity(value: unknown): Activity {
  return ActivitySchema.parse(value) as Activity;
}

/** Non-throwing variant of {@link parseActivity}. */
export function safeParseActivity(
  value: unknown,
): z.ZodSafeParseResult<Activity> {
  return ActivitySchema.safeParse(value) as z.ZodSafeParseResult<Activity>;
}
