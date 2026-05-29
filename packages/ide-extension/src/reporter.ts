/**
 * Reporter — debounced, offline-safe loopback POST of IDE context to the daemon.
 *
 * ## ESM/CJS interop decision
 * `@wdiot/shared` is an ESM-only package (`"type": "module"`); this extension
 * compiles to CommonJS (VSCode extension host requirement). Importing the ESM
 * package from CJS would force either a bundler step or `await import()` on
 * every send. The contract surface the extension actually needs is tiny — one
 * filename, two route paths, and the request shape — so we DUPLICATE those
 * small constants here. The daemon's `IngestRequestSchema` (zod) remains the
 * single source of truth and validates every payload server-side, so a drift
 * surfaces immediately as an HTTP 400 rather than silently. This keeps the
 * extension dependency-free and avoids bundling complexity.
 *
 * Offline-safe: if the discovery file is missing or the daemon is unreachable,
 * events are dropped quietly. The editor is never blocked and there is no
 * retry queue (plan Boundary 3 — events during daemon downtime are lost).
 */
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { FileEditPayload } from './collector.js';

// --- duplicated contract constants (see ESM/CJS note above) ----------------

/** Discovery file: `~/Library/Application Support/wdiot/ingest.json`. */
const DISCOVERY_FILE_PATH = join(
  homedir(),
  'Library',
  'Application Support',
  'wdiot',
  'ingest.json',
);

/** `POST /ingest` route on the daemon ingest server. */
const INGEST_PATH = '/ingest';

/** Shape of the discovery file the daemon writes (mode 0600). */
interface IngestDiscovery {
  port: number;
  token: string;
}

/** `POST /ingest` request body — mirrors `@wdiot/shared` `IngestRequest`. */
interface IngestRequest {
  type: 'file_edit';
  clientTs?: number;
  payload: FileEditPayload;
}

// --- reporter --------------------------------------------------------------

/** Debounce window for outbound sends (collapses bursts of editor events). */
const DEFAULT_DEBOUNCE_MS = 1500;

/** Per-request timeout — keeps a hung daemon from leaking timers. */
const REQUEST_TIMEOUT_MS = 2000;

/**
 * Read and parse the discovery file. Returns `undefined` when the file is
 * missing or malformed (daemon not running) — the caller drops the event.
 */
async function readDiscovery(): Promise<IngestDiscovery | undefined> {
  let raw: string;
  try {
    raw = await readFile(DISCOVERY_FILE_PATH, 'utf8');
  } catch {
    return undefined; // daemon not running / file absent — offline.
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as IngestDiscovery).port === 'number' &&
      typeof (parsed as IngestDiscovery).token === 'string' &&
      (parsed as IngestDiscovery).port > 0 &&
      (parsed as IngestDiscovery).token.length > 0
    ) {
      return parsed as IngestDiscovery;
    }
  } catch {
    // malformed file — fall through.
  }
  return undefined;
}

/**
 * Debounced, offline-safe reporter. Call {@link Reporter.report} with the
 * latest IDE-context payload; the most recent payload within the debounce
 * window is sent once. Call {@link Reporter.dispose} on extension deactivation.
 */
export class Reporter {
  private pending: FileEditPayload | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;

  constructor(private readonly debounceMs: number = DEFAULT_DEBOUNCE_MS) {}

  /**
   * Queue a payload for sending. Bursts collapse to a single POST of the
   * latest payload. Safe to call from any editor event listener.
   */
  report(payload: FileEditPayload): void {
    if (this.disposed) return;
    this.pending = payload;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      const toSend = this.pending;
      this.pending = undefined;
      if (toSend) void this.send(toSend);
    }, this.debounceMs);
  }

  /** Cancel any pending send and stop accepting new ones. */
  dispose(): void {
    this.disposed = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.pending = undefined;
  }

  /**
   * Send one payload to the daemon. Re-reads the discovery file on every
   * attempt so a daemon restart (new port/token) is picked up automatically.
   * All failures are swallowed — the editor must never be blocked.
   */
  private async send(payload: FileEditPayload): Promise<void> {
    const discovery = await readDiscovery();
    if (!discovery) return; // offline — drop quietly.

    const body: IngestRequest = {
      type: 'file_edit',
      clientTs: Date.now(),
      payload,
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      await fetch(`http://127.0.0.1:${discovery.port}${INGEST_PATH}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${discovery.token}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      // Response status is intentionally ignored: there is no retry queue and
      // a non-2xx response (e.g. stale token mid-restart) is dropped quietly.
    } catch {
      // Daemon unreachable / timeout / aborted — drop the event silently.
    } finally {
      clearTimeout(timeout);
    }
  }
}
