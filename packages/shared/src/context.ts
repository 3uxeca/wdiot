/**
 * Context-window + intent reconstruction types — Boundary 5 of the WDIOT v1 plan.
 *
 * On hotkey press the daemon slices the recent activity timeline, compresses it
 * into a `ContextDigest`, and asks the LLM to reconstruct an `IntentResult`
 * (one-line inferred intent + evidence + executable resume actions).
 */
import { z } from 'zod';
import { ActivitySchema, type Activity } from './activity.js';

/** Kinds of executable resume actions the palette can run. */
export type ResumeActionKind = 'open_tabs' | 'resume_work' | 'show_timeline';

/** A sleep/wake (or distraction) gap detected inside the raw slice. */
export interface GapAnnotation {
  /** epoch ms of the last event before the gap */
  from: number;
  /** epoch ms of the first event after the gap */
  to: number;
  durationMin: number;
}

/**
 * The raw, time-bounded slice of the timeline assembled on hotkey press.
 * This is the input to compression; it is NOT sent to the LLM directly.
 */
export interface ContextWindow {
  /** configured window length in minutes (default ~30) */
  rangeMinutes: number;
  /** epoch ms when the window was assembled */
  assembledAt: number;
  /** activities within the (gap-anchored) effective window, ordered by ts */
  activities: Activity[];
  /** present when a sleep/wake gap anchored the effective window start */
  gapDetected?: GapAnnotation;
}

/** A run-length-collapsed span of time on one application. */
export interface AppSpan {
  appName: string;
  from: number;
  to: number;
}

/** A deduplicated browser visit (latest visit of a URL kept). */
export interface BrowserVisit {
  browser: 'chrome' | 'safari';
  url: string;
  title: string;
  lastVisitTs: number;
}

/** A deduplicated search query. */
export interface SearchEntry {
  browser: 'chrome' | 'safari';
  engine: string;
  query: string;
  url: string;
  ts: number;
}

/** A collapsed file-edit entry for one file path. */
export interface FileEntry {
  workspacePath: string;
  filePath: string;
  editCount: number;
  lastCursorLine?: number;
  lastSelectionText?: string;
  hasGitDiff: boolean;
}

/**
 * The compact, structured digest produced by the compressor. This is the
 * payload that is sent to the LLM — never the raw activities.
 */
export interface ContextDigest {
  rangeMinutes: number;
  assembledAt: number;
  apps: AppSpan[];
  browser: BrowserVisit[];
  searches: SearchEntry[];
  files: FileEntry[];
  gapDetected?: GapAnnotation;
  /** true when the event cap forced dropping items from the digest */
  truncated: boolean;
}

/** The one-line inferred intent. */
export interface Intent {
  /** Korean inference sentence — non-empty. */
  summary: string;
  /** model confidence 0..1 */
  confidence: number;
}

/** Minimal evidence — bullets are Korean phrases. */
export type Evidence = string[];

/** An executable resume action returned by the LLM. */
export interface ResumeAction {
  /** Korean button label */
  label: string;
  kind: ResumeActionKind;
  /** action-specific payload, validated against the ContextWindow before run */
  payload: Record<string, unknown>;
}

/** The full 3-part result rendered in the palette. */
export interface IntentResult {
  intent: Intent;
  evidence: Evidence;
  actions: ResumeAction[];
}

// --- zod schemas -----------------------------------------------------------

export const ResumeActionKindSchema = z.enum([
  'open_tabs',
  'resume_work',
  'show_timeline',
]);

export const GapAnnotationSchema = z.object({
  from: z.number().int().nonnegative(),
  to: z.number().int().nonnegative(),
  durationMin: z.number().nonnegative(),
});

export const ContextWindowSchema = z.object({
  rangeMinutes: z.number().positive(),
  assembledAt: z.number().int().nonnegative(),
  activities: z.array(ActivitySchema),
  gapDetected: GapAnnotationSchema.optional(),
});

export const AppSpanSchema = z.object({
  appName: z.string().min(1),
  from: z.number().int().nonnegative(),
  to: z.number().int().nonnegative(),
});

export const BrowserVisitSchema = z.object({
  browser: z.enum(['chrome', 'safari']),
  url: z.string(),
  title: z.string(),
  lastVisitTs: z.number().int().nonnegative(),
});

export const SearchEntrySchema = z.object({
  browser: z.enum(['chrome', 'safari']),
  engine: z.string().min(1),
  query: z.string().min(1),
  url: z.string(),
  ts: z.number().int().nonnegative(),
});

export const FileEntrySchema = z.object({
  workspacePath: z.string().min(1),
  filePath: z.string().min(1),
  editCount: z.number().int().positive(),
  lastCursorLine: z.number().int().nonnegative().optional(),
  lastSelectionText: z.string().optional(),
  hasGitDiff: z.boolean(),
});

export const ContextDigestSchema = z.object({
  rangeMinutes: z.number().positive(),
  assembledAt: z.number().int().nonnegative(),
  apps: z.array(AppSpanSchema),
  browser: z.array(BrowserVisitSchema),
  searches: z.array(SearchEntrySchema),
  files: z.array(FileEntrySchema),
  gapDetected: GapAnnotationSchema.optional(),
  truncated: z.boolean(),
});

export const IntentSchema = z.object({
  /** must be a non-empty string — enforces "inference, not empty log". */
  summary: z.string().min(1, 'intent.summary must be a non-empty string'),
  confidence: z.number().min(0).max(1),
});

export const EvidenceSchema = z.array(z.string().min(1));

export const ResumeActionSchema = z.object({
  label: z.string().min(1),
  kind: ResumeActionKindSchema,
  payload: z.record(z.string(), z.unknown()),
});

/**
 * Strict shape of the 3-part palette result. `intent.summary` is enforced to be
 * a non-empty string (plan AC #9 automated gate).
 */
export const IntentResultSchema = z.object({
  intent: IntentSchema,
  evidence: EvidenceSchema,
  actions: z.array(ResumeActionSchema),
});
