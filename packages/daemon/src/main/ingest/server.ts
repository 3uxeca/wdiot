/**
 * Loopback ingest HTTP server — Boundary 3 of the WDIOT v1 plan.
 *
 * Binds `127.0.0.1:0` (OS-assigned dynamic port), generates a fresh 32-byte
 * hex auth token on every start, and publishes `{ port, token }` to the
 * discovery file `~/Library/Application Support/wdiot/ingest.json` (mode 0600)
 * so the IDE extension can find and authenticate to the daemon. The file is
 * deleted on stop.
 *
 * Work Unit C exposes a clean `startIngestServer` / `IngestServer.stop` API;
 * Work Unit F wires it into the app lifecycle (`main/index.ts`).
 */
import { createServer, type Server } from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { DISCOVERY_FILE_NAME } from '@wdiot/shared';
import { appDataDir, type Db } from '../storage/db.js';
import { createIngestRequestListener, type HealthProvider } from './handlers.js';

/** Loopback host the ingest server binds to — never network-exposed. */
const LOOPBACK_HOST = '127.0.0.1';

/** Auth token length in bytes (32 bytes -> 64 hex chars). */
const TOKEN_BYTES = 32;

/** Discovery file path: `~/Library/Application Support/wdiot/ingest.json`. */
export function discoveryFilePath(): string {
  return join(appDataDir(), DISCOVERY_FILE_NAME);
}

/** Options for {@link startIngestServer}. */
export interface IngestServerOptions {
  /** Open SQLite handle used to persist `file_edit` activities. */
  db: Db;
  /**
   * Optional capture-health provider for `GET /health`. Work Unit B owns the
   * real capture health; F wires it in. When omitted, `/health` returns a
   * basic ok payload with no per-source data.
   */
  healthProvider?: HealthProvider;
}

/** A running ingest server with its discovery details. */
export interface IngestServer {
  /** The OS-assigned port the server is listening on. */
  readonly port: number;
  /** The auth token clients must present as `Authorization: Bearer <token>`. */
  readonly token: string;
  /** Absolute path of the discovery file written for clients. */
  readonly discoveryPath: string;
  /** Stop the server and delete the discovery file. Idempotent. */
  stop(): Promise<void>;
}

/** Write the discovery file atomically with mode 0600 (user read/write only). */
function writeDiscoveryFile(path: string, port: number, token: string): void {
  mkdirSync(appDataDir(), { recursive: true });
  writeFileSync(path, JSON.stringify({ port, token }), { mode: 0o600 });
}

/** Delete the discovery file; tolerate it already being gone. */
function removeDiscoveryFile(path: string): void {
  rmSync(path, { force: true });
}

/**
 * Start the loopback ingest server. Resolves once the server is listening and
 * the discovery file has been published.
 */
export function startIngestServer(
  options: IngestServerOptions,
): Promise<IngestServer> {
  const token = randomBytes(TOKEN_BYTES).toString('hex');
  const discoveryPath = discoveryFilePath();

  const server: Server = createServer(
    createIngestRequestListener({
      db: options.db,
      token,
      healthProvider: options.healthProvider,
    }),
  );

  return new Promise<IngestServer>((resolve, reject) => {
    const onError = (err: Error): void => {
      server.removeListener('error', onError);
      reject(err);
    };
    server.once('error', onError);

    server.listen(0, LOOPBACK_HOST, () => {
      server.removeListener('error', onError);
      const address = server.address();
      if (address === null || typeof address === 'string') {
        server.close();
        reject(new Error('ingest server: failed to obtain a numeric port'));
        return;
      }

      const { port } = address;
      try {
        writeDiscoveryFile(discoveryPath, port, token);
      } catch (err) {
        server.close();
        reject(err instanceof Error ? err : new Error(String(err)));
        return;
      }

      let stopped = false;
      const stop = (): Promise<void> => {
        if (stopped) return Promise.resolve();
        stopped = true;
        removeDiscoveryFile(discoveryPath);
        return new Promise<void>((resolveStop) => {
          server.close(() => resolveStop());
        });
      };

      resolve({ port, token, discoveryPath, stop });
    });
  });
}
