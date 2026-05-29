/**
 * IDE-extension <-> daemon loopback HTTP contract — Boundary 3 of the plan.
 *
 * The daemon binds 127.0.0.1:0 and writes { port, token } to a discovery file;
 * the extension reads it and POSTs IDE-context events to `/ingest`. Route
 * constants and request/response shapes live here so neither side can drift.
 */
import { z } from 'zod';
import { FileEditPayloadSchema } from './activity.js';

/** HTTP routes exposed by the daemon ingest server. */
export const INGEST_ROUTES = {
  ingest: '/ingest',
  health: '/health',
} as const;

export type IngestRoute = (typeof INGEST_ROUTES)[keyof typeof INGEST_ROUTES];

/** HTTP methods, paired with their route, for unambiguous routing. */
export const INGEST_ENDPOINTS = {
  ingest: { method: 'POST', path: INGEST_ROUTES.ingest },
  health: { method: 'GET', path: INGEST_ROUTES.health },
} as const;

/** Bearer-token auth header name. */
export const AUTH_HEADER = 'authorization';

/** Discovery file path (relative to the macOS Application Support dir). */
export const DISCOVERY_FILE_NAME = 'ingest.json';

/** Shape of the discovery file the daemon writes (mode 0600). */
export interface IngestDiscovery {
  port: number;
  token: string;
}

export const IngestDiscoverySchema = z.object({
  port: z.number().int().positive(),
  token: z.string().min(1),
});

/**
 * POST /ingest request body — a single IDE-context event from the extension.
 * The daemon assigns `id`/`ts` server-side, so the extension only sends the
 * file_edit payload plus an optional client timestamp.
 */
export interface IngestRequest {
  /** always 'file_edit' in v1 — the extension is the only IDE source. */
  type: 'file_edit';
  /** epoch ms on the extension host; daemon may override with receive time. */
  clientTs?: number;
  payload: import('./activity.js').FileEditActivity['payload'];
}

export const IngestRequestSchema = z.object({
  type: z.literal('file_edit'),
  clientTs: z.number().int().nonnegative().optional(),
  payload: FileEditPayloadSchema,
});

/** POST /ingest response body. */
export interface IngestResponse {
  ok: boolean;
  /** id of the stored activity row, when ok */
  activityId?: string;
  /** error message, when not ok */
  error?: string;
}

export const IngestResponseSchema = z.object({
  ok: z.boolean(),
  activityId: z.string().optional(),
  error: z.string().optional(),
});

/** Per-source capture health state. */
export type CaptureHealthState = 'ok' | 'degraded' | 'denied';

export const CaptureHealthStateSchema = z.enum(['ok', 'degraded', 'denied']);

/** GET /health response body — daemon liveness + per-source capture health. */
export interface HealthResponse {
  ok: boolean;
  /** daemon version string */
  version: string;
  /** per-capture-source health, keyed by source name (app, chrome, safari, ide) */
  sources: Record<string, CaptureHealthState>;
}

export const HealthResponseSchema = z.object({
  ok: z.boolean(),
  version: z.string(),
  sources: z.record(z.string(), CaptureHealthStateSchema),
});
