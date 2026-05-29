/**
 * Ingest server integration tests — Work Unit C.
 *
 * Starts the real loopback HTTP server against an in-memory DB, then exercises:
 *  - discovery file is written with { port, token } and mode 0600
 *  - POST /ingest with the correct token persists a file_edit activity (2xx)
 *  - POST /ingest without a token is rejected (401)
 *  - POST /ingest with a wrong token is rejected (401)
 *  - a request with a non-loopback Host header is rejected (403)
 *  - GET /health returns an ok payload
 *  - stop() deletes the discovery file
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { FileEditActivity, IngestRequest } from '@wdiot/shared';

const execFileAsync = promisify(execFile);
import { openDatabase, type Db } from '../storage/db.js';
import { countActivities, sliceActivities } from '../storage/activity-repo.js';
import { startIngestServer, type IngestServer } from './server.js';

let db: Db;
let server: IngestServer;

beforeEach(async () => {
  db = openDatabase(':memory:');
  server = await startIngestServer({ db });
});

afterEach(async () => {
  await server.stop();
  db.close();
});

/** Build a valid `POST /ingest` body. */
function ingestBody(): IngestRequest {
  return {
    type: 'file_edit',
    clientTs: 1_700_000_000_000,
    payload: {
      workspacePath: '/Users/me/code/wdiot',
      filePath: '/Users/me/code/wdiot/src/index.ts',
      recentFiles: ['/Users/me/code/wdiot/src/a.ts'],
      cursorLine: 12,
      selectionText: 'const x = 1;',
      hasGitDiff: true,
    },
  };
}

/** POST JSON to the running ingest server with optional headers. */
function post(
  path: string,
  body: unknown,
  headers: Record<string, string>,
): Promise<Response> {
  return fetch(`http://127.0.0.1:${server.port}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

/**
 * Low-level POST via `node:http` — needed to set a forbidden header like
 * `Host`, which `fetch`/undici silently overrides to match the connection.
 */
function rawPost(
  path: string,
  body: string,
  headers: Record<string, string>,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port: server.port,
        path,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
          ...headers,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
      },
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

describe('discovery file', () => {
  it('writes { port, token } with mode 0600', () => {
    expect(existsSync(server.discoveryPath)).toBe(true);

    const parsed = JSON.parse(readFileSync(server.discoveryPath, 'utf8')) as {
      port: number;
      token: string;
    };
    expect(parsed.port).toBe(server.port);
    expect(parsed.token).toBe(server.token);
    expect(parsed.token).toMatch(/^[0-9a-f]{64}$/);

    const mode = statSync(server.discoveryPath).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('deletes the discovery file on stop()', async () => {
    await server.stop();
    expect(existsSync(server.discoveryPath)).toBe(false);
  });
});

describe('POST /ingest auth', () => {
  it('accepts a request with the correct Bearer token (2xx) and persists it', async () => {
    const res = await post('/ingest', ingestBody(), {
      authorization: `Bearer ${server.token}`,
    });
    expect(res.status).toBe(200);

    const json = (await res.json()) as { ok: boolean; activityId?: string };
    expect(json.ok).toBe(true);
    expect(json.activityId).toBeTruthy();

    expect(countActivities(db)).toBe(1);
    const [row] = sliceActivities(db, 0);
    expect(row?.type).toBe('file_edit');
    expect(row?.source).toBe('ide');
    expect(row?.projectId).toBeTruthy();
    const fileEdit = row as FileEditActivity;
    expect(fileEdit.payload.filePath).toBe('/Users/me/code/wdiot/src/index.ts');
    expect(fileEdit.ts).toBe(1_700_000_000_000);
  });

  it('rejects a request with no Authorization header (401)', async () => {
    const res = await post('/ingest', ingestBody(), {});
    expect(res.status).toBe(401);
    expect(countActivities(db)).toBe(0);
  });

  it('rejects a request with a wrong Bearer token (401)', async () => {
    const res = await post('/ingest', ingestBody(), {
      authorization: 'Bearer deadbeef-not-the-real-token',
    });
    expect(res.status).toBe(401);
    expect(countActivities(db)).toBe(0);
  });

  it('rejects a non-loopback Host header (403)', async () => {
    const res = await rawPost('/ingest', JSON.stringify(ingestBody()), {
      authorization: `Bearer ${server.token}`,
      host: 'evil.example.com',
    });
    expect(res.status).toBe(403);
    expect(countActivities(db)).toBe(0);
  });

  it('accepts a loopback Host header set explicitly (2xx)', async () => {
    const res = await rawPost('/ingest', JSON.stringify(ingestBody()), {
      authorization: `Bearer ${server.token}`,
      host: `localhost:${server.port}`,
    });
    expect(res.status).toBe(200);
    expect(countActivities(db)).toBe(1);
  });
});

describe('POST /ingest validation', () => {
  it('rejects an invalid payload shape (400)', async () => {
    const res = await post(
      '/ingest',
      { type: 'file_edit', payload: { nope: true } },
      { authorization: `Bearer ${server.token}` },
    );
    expect(res.status).toBe(400);
    expect(countActivities(db)).toBe(0);
  });

  it('rejects a non-JSON body (400)', async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/ingest`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${server.token}`,
      },
      body: 'not json',
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /health', () => {
  it('returns an ok payload with the correct token', async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/health`, {
      headers: { authorization: `Bearer ${server.token}` },
    });
    expect(res.status).toBe(200);

    const json = (await res.json()) as {
      ok: boolean;
      version: string;
      sources: Record<string, string>;
    };
    expect(json.ok).toBe(true);
    expect(json.version).toBe('0.1.0');
    expect(json.sources).toEqual({});
  });

  it('reflects a supplied health provider', async () => {
    await server.stop();
    server = await startIngestServer({
      db,
      healthProvider: () => ({ app: 'ok', chrome: 'denied' }),
    });
    const res = await fetch(`http://127.0.0.1:${server.port}/health`, {
      headers: { authorization: `Bearer ${server.token}` },
    });
    const json = (await res.json()) as { sources: Record<string, string> };
    expect(json.sources).toEqual({ app: 'ok', chrome: 'denied' });
  });

  it('rejects an unauthenticated /health request (401)', async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/health`);
    expect(res.status).toBe(401);
  });
});

describe('unknown routes', () => {
  it('returns 404 for an unknown authenticated route', async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/nope`, {
      headers: { authorization: `Bearer ${server.token}` },
    });
    expect(res.status).toBe(404);
  });
});

describe('curl smoke test', () => {
  /** Run `curl` and return its `-w '%{http_code}'` status line. */
  async function curlStatus(args: string[]): Promise<string> {
    const { stdout } = await execFileAsync('curl', [
      '-s',
      '-o',
      '/dev/null',
      '-w',
      '%{http_code}',
      ...args,
    ]);
    return stdout.trim();
  }

  it('curl without a token gets HTTP 401 (plan AC for Work Unit C)', async () => {
    const status = await curlStatus([
      '-X',
      'POST',
      '-H',
      'content-type: application/json',
      '-d',
      JSON.stringify(ingestBody()),
      `http://127.0.0.1:${server.port}/ingest`,
    ]);
    expect(status).toBe('401');
  });

  it('curl with the correct token gets HTTP 200', async () => {
    const status = await curlStatus([
      '-X',
      'POST',
      '-H',
      'content-type: application/json',
      '-H',
      `authorization: Bearer ${server.token}`,
      '-d',
      JSON.stringify(ingestBody()),
      `http://127.0.0.1:${server.port}/ingest`,
    ]);
    expect(status).toBe('200');
  });
});
