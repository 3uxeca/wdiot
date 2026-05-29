/**
 * Ingest HTTP route handlers — `POST /ingest` and `GET /health`.
 *
 * Security posture (plan Boundary 3):
 *  - Bearer-token auth: every request must carry `Authorization: Bearer <token>`.
 *  - Loopback-only `Host`: requests whose `Host` header is not a loopback
 *    address are rejected (DNS-rebinding defense).
 *  - No CORS headers — this is a server-to-server `fetch`, not a browser origin.
 */
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  AUTH_HEADER,
  INGEST_ROUTES,
  IngestRequestSchema,
  type FileEditActivity,
  type HealthResponse,
  type IngestResponse,
} from '@wdiot/shared';
import { insertActivity } from '../storage/activity-repo.js';
import { upsertProject } from '../storage/project-repo.js';
import type { Db } from '../storage/db.js';

/** Daemon version reported by `GET /health`. */
const DAEMON_VERSION = '0.1.0';

/** Max accepted request body size — IDE-context events are tiny. */
const MAX_BODY_BYTES = 64 * 1024;

/**
 * Capture-health provider for `GET /health`. Work Unit B owns the real capture
 * health state; F supplies an implementation. When absent, `/health` returns
 * an empty `sources` map.
 */
export type HealthProvider = () => HealthResponse['sources'];

/** Dependencies the request listener closes over. */
export interface IngestHandlerDeps {
  /** Open SQLite handle for persisting `file_edit` activities. */
  db: Db;
  /** Auth token clients must present as `Authorization: Bearer <token>`. */
  token: string;
  /** Optional capture-health provider for `GET /health`. */
  healthProvider?: HealthProvider;
}

/** Loopback hostnames accepted in the `Host` header (DNS-rebinding defense). */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

/** Strip an optional `:port` suffix and return the bare hostname, lowercased. */
function hostnameFromHostHeader(hostHeader: string): string {
  const trimmed = hostHeader.trim().toLowerCase();
  // IPv6 literal: `[::1]` or `[::1]:1234`.
  if (trimmed.startsWith('[')) {
    const close = trimmed.indexOf(']');
    return close === -1 ? trimmed : trimmed.slice(0, close + 1);
  }
  const colon = trimmed.indexOf(':');
  return colon === -1 ? trimmed : trimmed.slice(0, colon);
}

/** True when the request's `Host` header resolves to a loopback address. */
function isLoopbackHost(req: IncomingMessage): boolean {
  const hostHeader = req.headers.host;
  if (typeof hostHeader !== 'string' || hostHeader.length === 0) return false;
  return LOOPBACK_HOSTS.has(hostnameFromHostHeader(hostHeader));
}

/** Extract the bearer token from the `Authorization` header, if present. */
function bearerToken(req: IncomingMessage): string | undefined {
  const header = req.headers[AUTH_HEADER];
  const value = Array.isArray(header) ? header[0] : header;
  if (typeof value !== 'string') return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(value.trim());
  return match?.[1];
}

/** Send a JSON response with no CORS headers. */
function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

/** Read the full request body as a UTF-8 string, enforcing a size cap. */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        reject(new Error('request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** Derive a human-readable project name from a workspace path. */
function projectNameFromWorkspace(workspacePath: string): string {
  const segments = workspacePath.split('/').filter((s) => s.length > 0);
  return segments[segments.length - 1] ?? workspacePath;
}

/** Handle `POST /ingest`: build a `file_edit` Activity and persist it. */
async function handleIngest(
  req: IncomingMessage,
  res: ServerResponse,
  deps: IngestHandlerDeps,
): Promise<void> {
  let raw: string;
  try {
    raw = await readBody(req);
  } catch {
    sendJson(res, 413, { ok: false, error: 'request body too large' } satisfies IngestResponse);
    return;
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    sendJson(res, 400, { ok: false, error: 'invalid JSON body' } satisfies IngestResponse);
    return;
  }

  const parsed = IngestRequestSchema.safeParse(json);
  if (!parsed.success) {
    sendJson(res, 400, {
      ok: false,
      error: 'invalid ingest request: ' + parsed.error.message,
    } satisfies IngestResponse);
    return;
  }

  const { payload, clientTs } = parsed.data;
  const ts = clientTs ?? Date.now();

  // Resolve the project for this workspace; file_edit rows carry projectId.
  const project = upsertProject(
    deps.db,
    payload.workspacePath,
    projectNameFromWorkspace(payload.workspacePath),
  );

  const activity: FileEditActivity = {
    id: randomUUID(),
    type: 'file_edit',
    source: 'ide',
    ts,
    projectId: project.id,
    payload,
  };

  try {
    insertActivity(deps.db, activity);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[ingest] failed to persist file_edit activity:', message);
    sendJson(res, 500, { ok: false, error: 'storage error' } satisfies IngestResponse);
    return;
  }

  sendJson(res, 200, { ok: true, activityId: activity.id } satisfies IngestResponse);
}

/** Handle `GET /health`: daemon liveness + per-source capture health. */
function handleHealth(res: ServerResponse, deps: IngestHandlerDeps): void {
  const sources = deps.healthProvider ? deps.healthProvider() : {};
  sendJson(res, 200, {
    ok: true,
    version: DAEMON_VERSION,
    sources,
  } satisfies HealthResponse);
}

/**
 * Build the `http.Server` request listener. The returned function performs
 * auth + loopback checks before dispatching to a route handler.
 */
export function createIngestRequestListener(
  deps: IngestHandlerDeps,
): (req: IncomingMessage, res: ServerResponse) => void {
  return (req, res): void => {
    void (async (): Promise<void> => {
      // DNS-rebinding defense: reject non-loopback Host headers.
      if (!isLoopbackHost(req)) {
        sendJson(res, 403, { ok: false, error: 'non-loopback host rejected' });
        return;
      }

      // Bearer-token auth: reject missing or wrong tokens.
      const token = bearerToken(req);
      if (token !== deps.token) {
        sendJson(res, 401, { ok: false, error: 'unauthorized' });
        return;
      }

      const url = req.url ?? '';
      // Compare path only — ignore any query string.
      const path = url.split('?', 1)[0];
      const method = (req.method ?? 'GET').toUpperCase();

      if (method === 'POST' && path === INGEST_ROUTES.ingest) {
        await handleIngest(req, res, deps);
        return;
      }
      if (method === 'GET' && path === INGEST_ROUTES.health) {
        handleHealth(res, deps);
        return;
      }

      sendJson(res, 404, { ok: false, error: 'not found' });
    })().catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[ingest] unhandled request error:', message);
      if (!res.headersSent) {
        sendJson(res, 500, { ok: false, error: 'internal error' });
      } else {
        res.end();
      }
    });
  };
}
