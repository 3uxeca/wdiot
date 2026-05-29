# main/ingest

Loopback HTTP ingest server (plan Boundary 3). Receives IDE-context events from
the Cursor/VSCode extension and persists them as `file_edit` activities.

## Files

- `server.ts` — binds `127.0.0.1:0` (OS-assigned dynamic port), generates a
  fresh 32-byte hex auth token on each start, and publishes `{ port, token }`
  to `~/Library/Application Support/wdiot/ingest.json` (mode `0600`). Deletes
  the discovery file on `stop()`. Exposes `startIngestServer()` →
  `IngestServer { port, token, discoveryPath, stop() }` for Work Unit F to wire
  into the app lifecycle.
- `handlers.ts` — routes `POST /ingest` and `GET /health`. Enforces:
  - Bearer-token auth (`Authorization: Bearer <token>`) — 401 on missing/wrong.
  - Loopback-only `Host` header — 403 on a non-loopback host (DNS-rebinding
    defense).
  - No CORS headers (server-to-server `fetch`).
  - `POST /ingest`: validates the body with `IngestRequestSchema` (zod),
    resolves a `projectId` via `upsertProject`, inserts via `insertActivity`.
  - `GET /health`: returns `{ ok, version, sources }`. The optional
    `healthProvider` supplies per-source capture health (Work Unit B owns the
    real data; F wires it). Defaults to an empty `sources` map.

## Wiring (Work Unit F)

```ts
import { startIngestServer } from './ingest/server.js';

const ingest = await startIngestServer({ db });          // after app.whenReady()
// ... optionally: startIngestServer({ db, healthProvider })
app.on('before-quit', () => { void ingest.stop(); });    // deletes discovery file
```
