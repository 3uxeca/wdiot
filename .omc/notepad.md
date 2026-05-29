# Notepad
<!-- Auto-managed by OMC. Manual edits preserved in MANUAL section. -->

## Priority Context
<!-- ALWAYS loaded. Keep under 500 chars. Critical discoveries only. -->

## Working Memory
<!-- Session notes. Auto-pruned after 7 days. -->
### 2026-05-20 02:57
Work Unit C (IDE extension + ingest server) DONE. Created: daemon ingest/server.ts (loopback 127.0.0.1:0, 32-byte hex token, ingest.json mode 0600), ingest/handlers.ts (POST /ingest + GET /health, Bearer auth, non-loopback Host rejection, no CORS), ingest/ingest.test.ts (15 tests pass incl. curl 401/200). Extension: collector.ts (public VSCode APIs only, zero AI-chat), reporter.ts (debounced offline-safe POST), extension.ts (listeners). ESM/CJS interop: duplicated tiny contract constants in reporter.ts (extension is CJS, @wdiot/shared is ESM) — removed @wdiot/shared dep + tsconfig project ref from extension. NOTE for Work Unit E: packages/daemon/src/main/preload/palette-preload.ts line 15 import list is missing `ActionRunResult` (used at line 29) — blocks daemon `tsc -b` / electron-vite build. Not a Work Unit C bug.
### 2026-05-20 02:57
Work Unit D (context assembly + LLM provider) implemented & verified in packages/daemon/src/main/. Key facts for Work Unit E/F wiring:
- context/assembler.ts: assembleContextWindow(db, {rangeMinutes?, now?, limit?}) -> ContextWindow; detects largest >5min gap, anchors window to post-gap cluster.
- context/compressor.ts: compressContextWindow(window) -> Promise<ContextDigest>. OFF-LOOP via setImmediate yielding between the 4 collapse passes (chosen over worker_threads: v1 windows are bounded at 500 events, worker serialization overhead unjustified).
- llm/provider.ts: createLlmProvider({provider,apiKey,model?}) -> LlmProvider with reconstructIntent({digest,signal}). Default models claude-sonnet-4-6 / gpt-4o (PROVIDER_DEFAULT_MODELS).
- config/settings.ts: getSettings()/updateSettings()/resolveModel() via electron-store. config/keychain.ts: setApiKey/getApiKey/deleteApiKey via macOS `security` CLI.
- actions/executor.ts: runAction(action, window, {openTimeline, openExternal?}) — openTimeline callback is injected by Work Unit E (windows factory). validators.ts: validateAction cross-checks URLs/paths vs ContextWindow.activities.
GOTCHA for tests: seed-timeline file_edit rows reference fixed projectIds; with foreign_keys=ON you MUST insert projects first. Use the new helper context/__fixtures__/seed-projects.ts seedProjects(db). All 139 repo tests pass; daemon build + lint + tsc clean.
### 2026-05-29 15:47
Codex handoff continuation: Work Unit F runtime wiring started/done for local build. Added packages/daemon/src/main/runtime-backend.ts and wired main/index.ts to open SQLite, start CaptureScheduler, register IPC handlers with real assembler/compressor/LLM/action/timeline backend, register hotkey, create tray, and start ingest server with capture health provider. Tray now has working "타임라인 보기", hotkey conflict status, per-source health, and macOS privacy settings links. Verification: `npm run typecheck --workspace @wdiot/daemon` PASS; `npx vitest run --exclude packages/daemon/src/main/ingest/ingest.test.ts` PASS 124 tests; `npm run build` PASS. Full `npm test` in Codex sandbox fails only because loopback listen on 127.0.0.1 is blocked with EPERM, causing ingest tests to fail before server creation.


## 2026-05-20 02:57
Work Unit C (IDE extension + ingest server) DONE. Created: daemon ingest/server.ts (loopback 127.0.0.1:0, 32-byte hex token, ingest.json mode 0600), ingest/handlers.ts (POST /ingest + GET /health, Bearer auth, non-loopback Host rejection, no CORS), ingest/ingest.test.ts (15 tests pass incl. curl 401/200). Extension: collector.ts (public VSCode APIs only, zero AI-chat), reporter.ts (debounced offline-safe POST), extension.ts (listeners). ESM/CJS interop: duplicated tiny contract constants in reporter.ts (extension is CJS, @wdiot/shared is ESM) — removed @wdiot/shared dep + tsconfig project ref from extension. NOTE for Work Unit E: packages/daemon/src/main/preload/palette-preload.ts line 15 import list is missing `ActionRunResult` (used at line 29) — blocks daemon `tsc -b` / electron-vite build. Not a Work Unit C bug.


## MANUAL
<!-- User content. Never auto-pruned. -->
