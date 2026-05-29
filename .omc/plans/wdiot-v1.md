# WDIOT v1 — Implementation Plan (RALPLAN Consensus, rev 2)

> Source spec: `.omc/specs/deep-interview-wdiot.md` (ambiguity 17%, PASSED).
> Goal, Constraints, Non-Goals, Acceptance Criteria, Ontology are treated as fixed.
> Rev 2: addresses Architect SOUND-WITH-CHANGES + Critic ITERATE feedback (12 required changes,
> 2 should-fix items, 1 open question decision).
> Rev 2a: incorporates Korean-language requirement — all user-facing text in Korean; code
> identifiers, DB schema, and JSON keys remain English.

---

## RALPLAN-DR Summary

### Mode
SHORT (default). No `--deliberate` flag and no high-risk signal given. Pre-mortem and expanded
test plan are therefore omitted; a focused Risks section is included instead.

### Principles
1. **Inference over logging.** Every design choice serves "AI inferred my intent" — raw activity
   lists are an explicit failure mode per the spec.
2. **Local-by-default, egress only on demand.** Data lives in SQLite; bytes leave the machine only
   in the keystroke that fires the palette. No streaming, no background sync.
3. **Single-language simplicity.** TypeScript 100% across daemon, palette, and IDE extension —
   chosen for verification speed and debuggability over raw efficiency (Tauri deferred).
4. **Boring, swappable boundaries.** Favor the simplest mechanism that works (HTTP over custom
   IPC, in-process workers over child processes) and isolate vendor specifics behind interfaces
   (LLM provider, capture sources).
5. **v1 validates one hypothesis.** Is intent reconstruction itself valuable? Anything that does
   not feed that question (interrupt detection, clustering, snapshots) is out.

### Decision Drivers (top 3)
1. **Speed to a working "first chill" demo** — the v1 success metric is a felt experience, not
   coverage. Architecture must minimize moving parts. *Concretized in rev 2:* two-phase palette
   paint ensures a perceived-instant first paint (local digest < 100 ms) as an architectural
   property, not a hope.
2. **macOS capture reliability** — Accessibility/Automation permissions and AppleScript fragility
   are the highest-probability failure surface; the design must degrade gracefully. *Hardened in
   rev 2:* per-source health state, persistent vs transient failure distinction, mid-session
   revocation handling, partial-grant awareness (Chrome allowed / Safari denied).
3. **Pluggability without over-engineering** — LLM provider must be swappable (Claude→GPT) and
   capture sources must be independently testable, but no plugin runtime or DI framework.

### Viable Options for the 5 Architecture Boundaries

#### Boundary 1 — Electron main vs renderer split
- **Option A (CHOSEN): Main = all I/O + capture + DB + LLM; Renderer = pure presentation.**
  - Pros: single source of truth, renderer stays trivially testable/replaceable, no native
    modules in renderer (avoids contextIsolation/native-rebuild pain), security-clean.
  - Cons: main process is heavier; all data crosses IPC to render.
- **Option B: Renderer owns DB reads via `better-sqlite3` in a preload.**
  - Pros: fewer IPC hops for timeline view.
  - Cons: native module in renderer breaks contextIsolation hygiene, complicates packaging,
    splits the data layer. *Invalidated for v1.*

#### Boundary 2 — Background capture process structure
- **Option A (CHOSEN): In-process scheduled workers in main (no child process).**
  Active-app polling on a `setInterval`-class timer; AppleScript polling on a separate, slower
  timer; each capture call is `async` and serialized per-source so the event loop never blocks.
  Context-window compression (CPU-bound) runs in a `worker_threads` worker or yields via
  `setImmediate` between collapse passes so capture timers and the ingest server are never
  stalled during assembly (see B5 addendum).
  - Pros: simplest lifecycle, one process to supervise, trivial shared SQLite handle.
  - Cons: a hung `osascript` could delay other timers — mitigated by per-call timeout + abort.
- **Option B: Dedicated child process (`utilityProcess`) for capture.**
  - Pros: isolates AppleScript jank from menu-bar UI.
  - Cons: extra IPC channel, second DB connection or message-passing for writes, more
    supervision code. The jank concern is already solved by spawning `osascript` as its own
    short-lived subprocess with a timeout, so the child process buys little. *Invalidated for v1;
    revisit if profiling shows main-loop stalls.*

#### Boundary 3 — IDE extension ↔ desktop app communication
- **Option A (CHOSEN): Loopback HTTP server in the daemon (`127.0.0.1`, dynamic port).**
  Daemon binds port 0, writes the assigned port + a freshly generated auth token to a
  user-scoped discovery file at `~/Library/Application Support/wdiot/ingest.json` (mode 0600).
  The IDE extension's `reporter.ts` reads that file to discover `{ port, token }`.
  - Pros: VSCode/Cursor extension host has zero-friction `fetch`; language-agnostic; trivial to
    test with `curl`; daemon can also expose `/health`. Loopback-only = not network-exposed.
    Dynamic port eliminates conflicts; discovery file + token replaces a fixed shared secret.
  - Cons: extension must handle the file not yet existing (daemon not running) — solved by
    offline-safe retry.
- **Option B: File-drop (extension writes JSON to a watched dir).**
  - Pros: no network, no port.
  - Cons: fs-watch races, partial-write handling, cleanup, latency. *Invalidated.*
- **Option C: Native Electron IPC.**
  - Invalid — the extension runs in a separate VSCode/Cursor process, not an Electron renderer;
    there is no IPC channel to share. *Invalidated.*

#### Boundary 4 — Activity event schema
- **Option A (CHOSEN): Discriminated union in TS + single `activities` table with a typed
  `payload` JSON column + indexed `type`/`ts`.** Schema detailed in the plan body.
  - Pros: one insert path, one query path for the context window, easy migrations, payload
    stays flexible per variant while top-level columns stay indexable.
  - Cons: payload is opaque to SQL — acceptable since all slicing is by `ts`/`type`.
- **Option B: One table per event type.**
  - Pros: fully typed columns.
  - Cons: 4 tables, 4 inserts, a UNION query for every context window assembly, painful schema
    evolution. *Invalidated for a single-user v1.*

#### Boundary 5 — Context window assembly strategy
- **Option A (CHOSEN): On-demand SQL slice → dedupe/collapse → structured compression →
  single prompt with a strict JSON response contract.** Detailed in the plan body.
  *Rev 2 addenda:* (a) two-phase palette paint — main returns local digest immediately (phase 1),
  LLM result fills intent line asynchronously (phase 2); the single LLM call is unchanged.
  (b) Slice query carries an explicit `LIMIT` matching the hard event cap. (c) Compression runs
  off the main event loop (worker_thread or setImmediate yielding). (d) Sleep/wake gap detection
  anchors the window to the last activity cluster.
  - Pros: deterministic, debuggable, cheap (one LLM call), maps cleanly to the 3-part contract.
    Two-phase paint gives perceived-instant response aligned with Decision Driver #1.
  - Cons: a very busy 30 min can exceed token budget — mitigated by run-length collapsing and a
    hard event cap.
- **Option B: Multi-pass (summarize chunks, then summarize summaries).**
  - Pros: handles huge windows.
  - Cons: 2-3x latency and cost for a window that is almost always small. *Invalidated for v1;
    the single-pass path has a documented overflow fallback.*

### ADR (Architecture Decision Record)

| Field | Content |
|-------|---------|
| **Decision** | Single-process Electron main (capture + DB + LLM + ingest server), pure-presentation renderer, dynamic-port loopback HTTP for IDE extension, single `activities` table, on-demand single-pass context assembly with two-phase palette paint. |
| **Drivers** | Speed to felt experience; macOS capture reliability; pluggability without over-engineering. |
| **Alternatives considered** | DB-in-renderer (B1-B); child-process capture (B2-B); file-drop IPC (B3-B); table-per-event (B4-B); multi-pass summarization (B5-B). |
| **Why chosen** | Each alternative adds complexity (native module in renderer, second process lifecycle, fs-watch races, UNION queries, multi-call latency) without solving the v1 validation question. The chosen options form the minimal moving-parts architecture. |
| **Consequences** | Main process carries all load — monitor for event-loop stalls in practice. Loopback HTTP requires a discovery file. Two-phase paint adds a second IPC round-trip for the LLM phase. |
| **Follow-ups** | Profile main-loop stalls post-v1; if found, migrate capture to `utilityProcess` (B2-B). Evaluate native `active-win` module for richer NSWorkspace data. Consider Tauri rewrite if Electron memory proves problematic at scale. |

---

## Context

WDIOT ("왜켰더라" / "Why did I open this") is a macOS-only personal work-context restoration
agent. A menu-bar daemon passively records the user's activity timeline (active app, browser
tabs/URLs/searches, IDE file activity) into local SQLite. When the user loses their flow, a global
hotkey opens a palette that assembles the last ~30 minutes, sends it to a cloud LLM, and renders:
(1) a one-line **inferred** intent, (2) minimal evidence bullets, (3) **executable** resume actions.

Three components: (1) menu-bar daemon — Electron main process doing capture + storage + LLM;
(2) hotkey palette — an Electron renderer window (React + Tailwind); (3) a Cursor/VSCode-compatible
extension reporting IDE context over loopback HTTP.

This is greenfield. The working directory contains only `.omc/`.

## Work Objectives

1. Stand up an Electron + TypeScript monorepo with a menu-bar daemon and a palette window.
2. Implement passive capture: active app (NSWorkspace-class), browser (AppleScript), IDE (extension).
3. Persist a unified `Activity` timeline in SQLite.
4. On global hotkey, assemble the ~30-min `ContextWindow`, call a pluggable LLM provider, and
   render the 3-part result with executable actions.
5. Ship a Cursor/VSCode-compatible extension that POSTs IDE context to the daemon.

## Guardrails

### Must Have
- macOS only; single user; no auth/multiuser/scale code.
- TypeScript 100% across daemon, palette, and extension.
- Data egress ONLY on hotkey press — the assembled window, nothing else, no streaming.
- LLM provider is pluggable; Claude (Anthropic SDK) is the default, GPT swappable behind one interface.
- Resume actions are genuinely executable (re-open tabs, open timeline) — not text instructions.
- Intent summary reads as inference ("아마 ~하고 있었을 거예요, ~이후에"), never as a log dump.
- Action executor validates all LLM-produced payloads against the captured ContextWindow before
  execution (URL allowlist, path cross-check, tab count cap).
- **All user-facing text is Korean.** This includes:
  - Menu-bar tray menu items, tray warnings/status indicators.
  - Palette UI labels, buttons, placeholders, error messages
    (e.g. [작업 이어가기] [관련 탭 열기] [타임라인 보기]).
  - LLM-generated output: intent summary, evidence bullets, and action labels — all in Korean.
    The `prompt.ts` prompt builder must explicitly instruct the LLM to respond in Korean.
  - JSON contract structure/key names (`intent`, `evidence`, `actions`, `kind`, etc.) remain
    English. Only the **text values** inside the JSON are Korean.
  - Code identifiers, internal logs, DB schema/column names, and activity event type names
    remain English (developer convenience).

### Must NOT Have (Non-Goals — enforced)
- No interrupt/focus-break detection; no real-time agent intervention.
- No task clustering, flow retrospection, or emotion inference.
- No local/on-device LLM; no vector DB / embedding-based clustering.
- No reading of Cursor's internal AI chat content — the extension must not access it.
- No periodic Memory Snapshot system (on-demand ContextWindow replaces it).
- No Slack/Discord/Gmail; no browsers beyond Chrome/Safari; no IDEs beyond Cursor/VSCode.
- No Windows/Linux support.

---

## Repository Layout — Monorepo (decided)

**Decision: a single npm-workspaces monorepo.** Justification: the extension and the daemon
share the `Activity` schema and event types; a monorepo lets them import one `@wdiot/shared`
package so the HTTP contract cannot drift. Two separate repos would force schema duplication or a
published package for a single-user tool — unjustified overhead. The extension still builds and
packages independently (`.vsix`) from within the workspace.

```
wdiot/
  package.json                 # npm workspaces root; scripts: dev, build, package, test
  tsconfig.base.json
  packages/
    shared/                    # @wdiot/shared — types + zod schemas (one runtime dep: zod)
      src/
        activity.ts            # Activity discriminated union, payload types, zod schemas
        context.ts             # ContextWindow, Intent, Evidence, ResumeAction types + schemas
        ingest-contract.ts     # IDE->daemon HTTP request/response types + route consts
        llm-contract.ts        # LLM request shape + strict JSON response zod schema
      package.json             # dependencies: { "zod": "^3.x" }
    daemon/                    # @wdiot/daemon — Electron app (main + renderer)
      src/
        main/
          index.ts             # app bootstrap, tray, single-instance lock, lifecycle
          tray.ts              # menu-bar icon + menu (종료, 설정, 타임라인 보기, 수집 상태); all labels Korean
          windows.ts           # palette BrowserWindow + timeline BrowserWindow factory
          hotkey.ts            # globalShortcut register/unregister (Cmd+Shift+W) + conflict detection
          ipc.ts               # ipcMain handlers (renderer <-> main contract)
          capture/
            scheduler.ts       # owns the capture timers; start/stop; jank guard
            health.ts          # per-source health state machine (ok/degraded/denied); tray integration
            app-source.ts      # active app + window title via NSWorkspace-class API
            browser-source.ts  # Chrome/Safari tabs/URLs via osascript
            applescript.ts     # osascript runner: spawn + timeout + abort
            scripts/           # .applescript / .scpt templates (Chrome, Safari)
          ingest/
            server.ts          # loopback HTTP server, dynamic port, token auth, discovery file
            handlers.ts        # /ingest, /health route handlers
          storage/
            db.ts              # better-sqlite3 connection, pragmas, migrations runner
            migrations/        # 0001_init.sql ...
            activity-repo.ts   # insert Activity, slice by time range (with LIMIT)
            project-repo.ts    # upsert/lookup Project by workspace path
          context/
            assembler.ts       # build ContextWindow from a time slice; sleep/wake gap detection
            compressor.ts      # dedupe, run-length collapse, token-bounded shaping (off-loop)
            __fixtures__/      # seeded timeline data shared by tests + golden cases
              seed-timeline.ts # factory: creates a realistic 30-min Activity[] for testing
              golden-cases.ts  # (seeded timeline -> expected shape) for AC #9 rubric
          llm/
            provider.ts        # LlmProvider interface + registry/factory
            claude-provider.ts # Anthropic SDK implementation (default)
            openai-provider.ts # OpenAI implementation (swappable)
            prompt.ts          # system + user prompt builder, JSON contract; Korean output directive
          actions/
            executor.ts        # runs ResumeAction kinds; payload validation + cross-check
            validators.ts      # URL allowlist, path cross-check, tab count cap
          config/
            settings.ts        # window minutes, hotkey, provider choice
            keychain.ts        # macOS Keychain read/write for API key
        renderer/
          palette/             # React + Tailwind palette UI
            App.tsx            # two-phase: instant local digest -> LLM intent fill
            components/        # IntentLine, EvidenceList, ResumeActions
            main.tsx
            index.html
          timeline/            # React + Tailwind timeline viewer
            App.tsx
            main.tsx
            index.html
          shared-ui/           # tailwind config, primitives
        preload/
          palette-preload.ts   # contextBridge: typed, minimal API surface
          timeline-preload.ts
      electron.vite.config.ts  # electron-vite: main + preload + 2 renderers
      package.json
    ide-extension/             # @wdiot/ide-extension — Cursor/VSCode compatible
      src/
        extension.ts           # activate/deactivate; event listeners; debounce
        collector.ts           # workspace, active file, recent files, cursor/selection, git diff flag
        reporter.ts            # reads ~/Library/Application Support/wdiot/ingest.json for port+token;
                               # POST events to daemon loopback HTTP; retry/backoff; offline-safe
      package.json             # engines.vscode; contributes; activationEvents
      tsconfig.json
  .omc/
```

`Project` (Ontology supporting entity) is materialized via `project-repo.ts`; `Task` and
`Snapshot` are deferred entities and get **no** tables or code in v1.

---

## Recommended npm Dependencies

**Daemon (`packages/daemon`)**
- `electron` — host framework.
- `electron-vite` + `vite` — build for main/preload/renderer; fast HMR for the palette.
- `better-sqlite3` — synchronous SQLite, ideal for a single-process main; main-only (Boundary 1).
- `@anthropic-ai/sdk` — default LLM provider.
- `openai` — swappable provider.
- `react`, `react-dom` — palette + timeline renderers.
- `tailwindcss`, `postcss`, `autoprefixer` — styling.
- `zod` — (via `@wdiot/shared`; also a direct dev dependency for test helpers).
- `electron-builder` — packaging/notarization-ready (signing optional for personal use).
- Global hotkey: Electron's built-in `globalShortcut` (no extra dependency).
- Active-app capture: built-in `osascript` via `child_process` as the **default** source;
  optionally `node-mac-permissions` (or `active-win`) evaluated in Work Unit B for richer
  NSWorkspace data — see Risks.
- `electron-store` — small JSON store for non-secret settings (window minutes, provider choice,
  hotkey binding). API keys are stored separately via macOS Keychain (see below).

**IDE extension (`packages/ide-extension`)**
- `@types/vscode`, `vscode` engine — extension API (Cursor reuses it).
- `@vscode/vsce` — package `.vsix`.
- Built-in `fetch` (Node 18+ in the extension host) — POST to the daemon; no HTTP client dep.

**Shared (`packages/shared`)**
- `zod` — single runtime dependency. Exports both TypeScript types and their corresponding zod
  schemas for validation at runtime boundaries (LLM response, ingest payload, action payloads).

**Dev (root)**
- `typescript`, `vitest`, `@types/node`, `eslint`, `prettier`, `concurrently`.

---

## Architecture Boundary Resolutions (detail)

### B1 — Main vs Renderer
- **Main process** owns: tray, global hotkey, capture scheduler + all 3 capture sources + capture
  health state, the loopback ingest HTTP server, the SQLite connection, context
  assembly/compression, the LLM provider call, action validation + execution, settings, and
  Keychain access.
- **Renderer** (palette + timeline) owns: presentation only. It receives data and dispatches
  intents via a typed `contextBridge` API exposed in preload. `nodeIntegration: false`,
  `contextIsolation: true`, `sandbox: true`.
- IPC surface (typed in `shared/ingest-contract.ts` style under `ipc.ts`):
  - `palette:invoke` (renderer->main) -> **two-phase response**:
    - Phase 1 (immediate): main returns the local compressed digest (evidence region data).
      Renderer paints EvidenceList instantly (target < 100 ms from hotkey press, pure local
      SQL + compression).
    - Phase 2 (async): main calls the LLM, then pushes the `IntentResult` (intent summary +
      refined actions) to the renderer via a second IPC message. Renderer fills IntentLine and
      ResumeActions. If the LLM call fails, the palette shows an error with retry affordance
      while still displaying the local evidence.
  - `action:run` (renderer->main, payload `ResumeAction`) -> validates + executes the action.
  - `timeline:query` (renderer->main) -> returns activities for the timeline window.

### B2 — Capture scheduling
- `capture/scheduler.ts` owns two independent timers:
  - **App timer** (~1-2 s): calls `app-source.ts`. The active-app read is fast.
  - **Browser timer** (~5-10 s): calls `browser-source.ts`, which shells out to `osascript`.
- Each source call is `async` and **serialized per source** with a re-entrancy guard (skip a
  tick if the previous run has not resolved). `osascript` runs as a short-lived subprocess with
  a **hard timeout (e.g. 3 s) + abort**, so a hung AppleScript cannot stall the loop.
- App switches are recorded **edge-triggered**: only write an `app_switch` row when the
  active-app identity changes, not every tick (keeps the timeline sparse and meaningful).
- No child process — see RALPLAN-DR Boundary 2.
- **Capture health** (`capture/health.ts`) maintains a per-source state machine with three states:
  - `ok` — source is capturing normally.
  - `degraded` — transient failures (osascript timeout, temporary error); scheduler skips the
    tick but keeps retrying. After N consecutive transient failures, escalates to `denied`.
  - `denied` — permission denied detected (exit code or error string from osascript indicating
    "not allowed" / "assistive access"); persistent until the user grants permission.
  - On any `denied` transition: surface a menu-bar warning indicator (tray icon badge or tooltip
    change) + a tray menu item in Korean linking to the relevant System Settings pane (e.g.
    "Chrome 자동화 권한 필요 — 설정 열기", "손쉬운 사용 권한 필요 — 설정 열기").
  - **Partial-grant awareness**: Chrome and Safari have independent Automation grants. If Chrome
    is granted but Safari is denied, `browser-source.ts` reports per-browser health. The tray
    menu shows per-source status in Korean (e.g. "Chrome: 정상", "Safari: 권한 필요").
  - **Mid-session revocation**: the scheduler detects permission revocation (a previously `ok`
    source starts returning permission errors) and transitions to `denied` immediately, updating
    the tray indicator without requiring a restart.
  - `GET /health` on the ingest server also returns capture health per source, so the IDE
    extension (or a `curl` check) can verify the daemon's state.

### B3 — IDE extension <-> daemon (revised: dynamic port + token auth)
- Daemon starts its loopback HTTP server by binding to `127.0.0.1:0` (OS-assigned dynamic port),
  started after `app.whenReady()` and stopped on quit.
- On startup the daemon generates a cryptographically random 32-byte hex token and writes
  `{ "port": <number>, "token": "<hex>" }` to exactly
  `~/Library/Application Support/wdiot/ingest.json` with file mode `0600` (user-read-write only).
  On quit, the file is deleted.
- Routes (`shared/ingest-contract.ts`): `POST /ingest` (IDE-context event), `GET /health`.
- **Auth enforcement**: the daemon rejects any request missing the `Authorization: Bearer <token>`
  header. It also rejects requests whose `Host` header resolves to a non-loopback address (defense
  against DNS rebinding). No CORS headers are set (not needed for server-to-server `fetch`).
- The extension's `reporter.ts` reads `~/Library/Application Support/wdiot/ingest.json` on
  activation and on each send attempt (handles daemon restart with a new port/token). If the file
  does not exist or the daemon is unreachable, the extension is **offline-safe**: it drops events
  quietly and never blocks the editor. No retry queue in v1 — events during daemon downtime are
  simply lost (acceptable for a personal tool; the daemon is expected to always be running).
- The extension **never** reads Cursor AI chat — `collector.ts` only touches public VSCode APIs:
  `workspace.workspaceFolders`, `window.activeTextEditor`, recent docs, selection, and a git
  `diff --quiet` boolean. This is enforced by code review against Acceptance Criterion #10.

### B4 — Activity event schema
TypeScript discriminated union in `shared/activity.ts`:

```ts
import { z } from 'zod';

export type ActivityType = 'app_switch' | 'browser_tab' | 'file_edit' | 'search';
export type ActivitySource = 'app' | 'browser' | 'ide';

interface ActivityBase {
  id: string;            // uuid
  type: ActivityType;
  source: ActivitySource;
  ts: number;            // epoch ms (UTC)
  projectId?: string;    // FK -> projects.id, when resolvable (see Project Resolution below)
}

export interface AppSwitchActivity extends ActivityBase {
  type: 'app_switch';
  payload: { appName: string; bundleId?: string; windowTitle?: string };
}
export interface BrowserTabActivity extends ActivityBase {
  type: 'browser_tab';
  payload: { browser: 'chrome' | 'safari'; url: string; title: string; active: boolean };
}
export interface FileEditActivity extends ActivityBase {
  type: 'file_edit';
  payload: {
    workspacePath: string; filePath: string;
    recentFiles?: string[]; cursorLine?: number;
    selectionText?: string; hasGitDiff: boolean;
  };
}
export interface SearchActivity extends ActivityBase {
  type: 'search';
  payload: { browser: 'chrome' | 'safari'; engine: string; query: string; url: string };
}

export type Activity =
  | AppSwitchActivity | BrowserTabActivity | FileEditActivity | SearchActivity;

// Zod schemas for runtime validation at boundaries (LLM response, ingest, actions)
export const AppSwitchPayloadSchema = z.object({ ... });
// ... (full schemas co-located with types)
```

**Project resolution** (change #12): `projectId` is set **only on `file_edit` activities** from
the IDE extension, because those are the only events that carry an unambiguous `workspacePath`.
`app_switch`, `browser_tab`, and `search` rows have `projectId = null`. The timeline "project
grouping" feature groups `file_edit` rows by project and shows non-IDE rows in a separate
"General" section. This avoids brittle heuristics (e.g., guessing which browser tab relates to
which project from URL patterns) which would add complexity without v1 value.

SQLite table (`migrations/0001_init.sql`):

```sql
CREATE TABLE projects (
  id           TEXT PRIMARY KEY,
  workspace    TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  created_at   INTEGER NOT NULL
);

CREATE TABLE activities (
  id           TEXT PRIMARY KEY,
  type         TEXT NOT NULL,          -- app_switch | browser_tab | file_edit | search
  source       TEXT NOT NULL,          -- app | browser | ide
  ts           INTEGER NOT NULL,       -- epoch ms
  project_id   TEXT REFERENCES projects(id),
  payload      TEXT NOT NULL           -- JSON, variant-specific
);

CREATE INDEX idx_activities_ts        ON activities(ts);
CREATE INDEX idx_activities_type_ts   ON activities(type, ts);
CREATE INDEX idx_activities_project   ON activities(project_id);
```

`idx_activities_ts` powers the context-window range slice; `idx_activities_type_ts` powers
per-type filtering/dedup; `idx_activities_project` powers project grouping in the timeline view.
Pragmas: `journal_mode=WAL`, `synchronous=NORMAL`, `foreign_keys=ON`.

### B5 — Context window assembly (revised: two-phase + bounded + off-loop + sleep/wake)

On hotkey press, the main process runs two phases:

**Phase 1 — Local digest (target < 100 ms, synchronous from the renderer's perspective):**

1. **Bounded slice** — `SELECT * FROM activities WHERE ts >= ? ORDER BY ts LIMIT ?`
   where `?` = `now - rangeMinutes*60000` and LIMIT = the hard event cap (e.g. 500 events).
   Uses `idx_activities_ts`.

2. **Sleep/wake gap detection** — `assembler.ts` scans the sorted slice for any gap between
   consecutive events exceeding a threshold (e.g. 5 minutes). If found:
   - Anchor the effective window start to the first event *after* the largest gap. This ensures
     the "returning after a distraction" scenario — the primary trigger — produces a window of
     the most recent activity cluster, not a stale pre-gap segment.
   - Include a `gapDetected: { from: ts, to: ts, durationMin: number }` annotation in the
     ContextWindow so the LLM prompt can reference the gap (e.g., "you came back N minutes ago
     after a break").

3. **Dedupe / collapse** (`compressor.ts`, run off the main event loop via `worker_threads`
   worker or `setImmediate` yielding between collapse passes so capture timers and the ingest
   server are never blocked):
   - `app_switch`: run-length collapse consecutive same-app rows into one `{app, from, to}` span.
   - `browser_tab`: drop duplicate `url` keeping the latest visit; mark `search` rows distinctly.
   - `file_edit`: collapse repeated edits of the same `filePath` into one entry with edit count
     and last cursor/selection.

4. **Compress / shape** — produce a compact structured digest grouped as: apps timeline,
   browser activity, searches, IDE files. If events still exceed the token budget after collapse,
   keep the most recent and the longest-dwell items and note truncation.

5. **Return the local digest** to the renderer immediately via IPC (`palette:digest`). The
   renderer paints the EvidenceList region with locally-derived evidence bullets (Korean label:
   "최근 활동:"). IntentLine shows a "생각하는 중..." placeholder. ResumeActions show skeleton
   buttons.

**Phase 2 — LLM intent reconstruction (async, ~1-5 s):**

6. **Prompt** (`llm/prompt.ts`) — a system prompt instructing the model to **infer intent, not
   list activity**, and to **produce all text values in Korean** (intent summary, evidence
   bullets, action labels). The prompt must contain an explicit directive such as:
   "모든 텍스트 출력은 반드시 한국어로 작성하세요. JSON 키 이름은 영어를 유지합니다."
   The compressed digest + gap annotation are appended, requesting a **strict JSON** response:
   ```json
   {
     "intent": { "summary": "아마 Chart.js 주석 오프셋 버그를 고치고 있었을 거예요, 줌 인터랙션 관련 코드를 확인한 이후에.", "confidence": 0.85 },
     "evidence": ["QueueChart.tsx를 수정했어요", "'chartjs annotation zoom'을 검색했어요", "chartOptions.ts를 확인했어요"],
     "actions": [
       { "label": "관련 탭 열기", "kind": "open_tabs", "payload": {} },
       { "label": "작업 이어가기", "kind": "resume_work", "payload": {} },
       { "label": "타임라인 보기", "kind": "show_timeline", "payload": {} }
     ]
   }
   ```
   Note: JSON keys (`intent`, `evidence`, `actions`, `label`, `kind`, `payload`) are always
   English. Only the string **values** are Korean.

7. **Parse & validate** — `zod`-validate the response shape. Then apply action-specific
   hardening (see Action Executor Hardening below).

8. **Push to renderer** via IPC (`palette:intent`). The renderer fills IntentLine and updates
   ResumeActions with real buttons. If the LLM call fails or is cancelled, the renderer shows
   an error with retry while keeping the local evidence visible.

### Action Executor Hardening (change #3)

`actions/executor.ts` + `actions/validators.ts` enforce the following before executing any
LLM-suggested action:

1. **URL scheme allowlist**: for `open_tabs` actions, every URL in `payload.urls` must have
   scheme `http` or `https`. All other schemes (`file:`, `javascript:`, `data:`, custom) are
   rejected and the action is skipped with a log warning.

2. **Cross-check against ContextWindow**: every URL in an `open_tabs` action and every file
   path / workspace path in a `resume_work` action must be present in the captured
   `ContextWindow.activities` that was sent to the LLM. If a URL or path is not found in the
   window, it is silently dropped from the action payload. If all items are dropped, the action
   is disabled in the palette with a Korean tooltip explaining the mismatch (e.g. "실행할 수
   있는 항목이 없습니다").

3. **Tab count cap**: `open_tabs` actions are capped at **10 tabs** maximum. If the LLM
   suggests more, only the first 10 (after cross-check filtering) are opened. The palette shows
   "(10개 중 N개)" to indicate truncation (Korean).

4. **`show_timeline`** is always safe (opens the internal timeline window with a time range);
   no additional validation needed beyond zod shape check.

---

## Pluggable LLM Provider Interface

`packages/daemon/src/main/llm/provider.ts`:

```ts
import type { ContextDigest, IntentResult } from '@wdiot/shared';

export interface LlmProvider {
  readonly id: 'claude' | 'openai';
  /** Single-call intent reconstruction. Must return strict, validated IntentResult. */
  reconstructIntent(input: {
    digest: ContextDigest;
    signal?: AbortSignal;
  }): Promise<IntentResult>;
}

export interface LlmProviderConfig {
  provider: 'claude' | 'openai';
  apiKey: string;
  model?: string;
}

export function createLlmProvider(cfg: LlmProviderConfig): LlmProvider;
```

`claude-provider.ts` (default) and `openai-provider.ts` each implement `reconstructIntent`,
build the prompt via `prompt.ts`, request JSON output, and `zod`-validate before returning.
Swapping providers is a one-line settings change; no other code changes.

## API Key Storage (decided: macOS Keychain)

**Decision: macOS Keychain.** The daemon stores the LLM API key in the system Keychain via the
`security` CLI (`security add-generic-password` / `security find-generic-password`), wrapped in
`config/keychain.ts`. Electron apps on macOS can access the Keychain without extra entitlements
for self-owned items.

Rationale: `electron-store` writes a plaintext JSON file; for a tool the developer leaves always
running, Keychain is the platform-correct choice and costs ~30 lines of `child_process` wrapping
around the `security` binary. No additional npm dependency needed.

`electron-store` remains for non-secret settings (window minutes, provider choice, hotkey
binding). API keys never appear in the settings file.

## Palette Result Rendering Contract (revised: two-phase paint)

The palette renderer implements a **two-phase paint**:

**Phase 1 — Instant local paint (< 100 ms from hotkey press):**
- **EvidenceList** — rendered immediately from the local compressed digest returned by
  `palette:digest`. Shows 2-4 locally-derived bullets: recently edited files, browser tabs,
  app switches. These are facts, not inferences — labeled "최근 활동:" (Korean).
- **IntentLine** — shows a shimmer/skeleton "생각하는 중..." placeholder (Korean).
- **ResumeActions** — shows skeleton/disabled button placeholders.

**Phase 2 — LLM-driven fill (~1-5 s after hotkey press):**
- **IntentLine** — filled with the one-line inferred summary from `palette:intent`, styled as
  a Korean sentence ("아마 ~하고 있었을 거예요, ~이후에"), never a bullet list. Optional subtle
  confidence indicator.
- **EvidenceList** — updated/refined with the LLM's curated Korean evidence bullets
  ("QueueChart.tsx를 수정했어요 · 'chartjs annotation zoom'을 검색했어요 · chartOptions.ts를
  확인했어요"). Replaces the local bullets with the inferred version.
- **ResumeActions** — real buttons appear with Korean labels (e.g. [작업 이어가기]
  [관련 탭 열기] [타임라인 보기]), one per `ResumeAction`. Clicking dispatches `action:run`
  over IPC; the main process validates and executes. States: loading (LLM in flight, with a
  cancel affordance), result, and error (with retry). If the LLM call failed, the palette keeps
  phase-1 evidence visible and shows an error banner with a "다시 시도" (retry) button.

All palette UI chrome text (section headers, error messages, tooltips, button labels) is Korean.
Only code identifiers in the DOM (`data-testid`, CSS class names) remain English.

---

## Ordered, Parallelizable Work Units

Work Unit A is the blocking prerequisite (includes storage layer). B, C, D, E run **in parallel**
after A — each depends only on A's outputs (shared types, DB schema, Electron skeleton). F
depends on B-E for integration.

### Work Unit A — Monorepo scaffold + shared contracts + storage layer  *(blocking)*
- Root `package.json` (npm workspaces), `tsconfig.base.json`, eslint/prettier, `vitest`.
- `packages/shared`: `activity.ts`, `context.ts`, `ingest-contract.ts`, `llm-contract.ts`, all
  with co-located zod schemas. `package.json` declares `zod` as the single runtime dependency.
- `packages/daemon` skeleton with `electron-vite` config (main + preload + 2 renderers).
- `packages/ide-extension` skeleton with `package.json` manifest.
- **Storage layer** (moved here from Work Unit B to unblock C and D):
  `storage/db.ts`, `migrations/0001_init.sql`, `activity-repo.ts`, `project-repo.ts`.
  The bounded-slice query in `activity-repo.ts` includes `LIMIT` matching the hard event cap.
- **Seeded timeline fixture** at `packages/daemon/src/main/context/__fixtures__/seed-timeline.ts`:
  a factory function that generates a realistic 30-min `Activity[]` (including app switches,
  Chrome/Safari tabs, search queries, file edits across 2 projects, and an embedded 7-minute
  sleep/wake gap). This fixture is shared by assembler/compressor unit tests (Work Unit D) and
  the AC #9 golden cases. `golden-cases.ts` co-located in `__fixtures__/` defines 3-5 seeded
  timeline scenarios with expected output shape assertions (see AC #9 verification). All
  expected `intent.summary`, `evidence[]`, and `actions[].label` values in the golden fixtures
  are written in Korean.
- **Acceptance:**
  - `npm run build` compiles all three packages.
  - An empty Electron app launches a menu-bar tray icon.
  - `vitest` passes for shared schema validation.
  - `better-sqlite3` creates the DB, runs migrations, and `activity-repo.ts` round-trips an
    insert + slice query.

### Work Unit B — Capture layer  *(parallel, after A)*
- `capture/scheduler.ts`, `capture/health.ts`, `capture/app-source.ts`,
  `capture/applescript.ts`, `capture/browser-source.ts` + `scripts/` for Chrome and Safari.
- Edge-triggered `app_switch`; AppleScript browser polling with timeout/abort.
- Per-source health state machine (`ok`/`degraded`/`denied`); tray integration for degraded
  indicators and System Settings deep-links.
- **Acceptance:**
  - With the app running, switching apps and browsing writes correct `app_switch` /
    `browser_tab` / `search` rows; `osascript` timeouts never stall the loop.
  - Revoking Automation permission for Chrome mid-session transitions that source to `denied`
    within one polling cycle and surfaces a Korean tray warning (e.g. "Chrome: 권한 필요").
    Safari independently stays `ok` ("Safari: 정상").
  - Re-granting permission transitions back to `ok` on the next successful poll.

### Work Unit C — IDE extension + ingest server  *(parallel, after A)*
- `ingest/server.ts` + `handlers.ts` (loopback HTTP, dynamic port, token auth, discovery file
  at `~/Library/Application Support/wdiot/ingest.json` mode 0600).
- Extension `extension.ts`, `collector.ts` (public VSCode APIs only), `reporter.ts` (reads
  discovery file for port + token; debounced POST; offline-safe; re-reads on send failure to
  handle daemon restart).
- **Acceptance:**
  - Editing a file in Cursor/VSCode produces `file_edit` rows with workspace, active file,
    recent files, cursor/selection, and `hasGitDiff`; no Cursor AI chat data appears.
  - With the daemon stopped, the extension does not error or block the editor.
  - After daemon restart (new port/token), the extension re-discovers and reconnects within one
    polling cycle.
  - `curl` without the correct token gets HTTP 401.

### Work Unit D — Context assembly + LLM provider  *(parallel, after A)*
- `context/assembler.ts` (with sleep/wake gap detection), `context/compressor.ts` (off-loop via
  worker_threads or setImmediate yielding).
- `llm/provider.ts`, `claude-provider.ts`, `openai-provider.ts`, `prompt.ts`.
- `config/settings.ts` (window minutes, provider choice, hotkey binding via `electron-store`).
- `config/keychain.ts` (API key storage via macOS `security` CLI).
- `actions/executor.ts` + `actions/validators.ts` (URL allowlist, cross-check, tab count cap).
- **Acceptance:**
  - Given the seeded timeline fixture (from A), the assembler produces a bounded digest.
  - The sleep/wake gap scenario correctly anchors the window to the post-gap cluster.
  - The Claude provider returns a `zod`-valid `IntentResult` whose `intent.summary`,
    `evidence[]`, and `actions[].label` values are all in Korean.
  - `validators.ts` rejects `javascript:` URLs, paths not in the window, and > 10 tabs.
  - Golden-case tests pass with Korean expected outputs (see AC #9 verification).

### Work Unit E — Palette + timeline UI + hotkey  *(parallel, after A)*
- `main/hotkey.ts` (with `globalShortcut.register` return-value check + tray conflict warning),
  `main/windows.ts`, `main/ipc.ts` (two-phase: `palette:digest` + `palette:intent`), `preload/*`.
- Renderers: `palette/` (two-phase paint: IntentLine, EvidenceList, ResumeActions with
  skeleton/shimmer states) and `timeline/`.
- **Acceptance:**
  - `Cmd+Shift+W` opens the palette; loading state shows "생각하는 중..." and error states
    render with Korean messages.
  - If `globalShortcut.register` returns `false`, the tray menu shows "단축키 충돌:
    Cmd+Shift+W가 다른 앱에서 사용 중입니다" and palette does not silently fail.
  - The timeline window lists activities.
  - Phase-1 local paint renders within 100 ms (measured via DevTools performance trace in the
    renderer).
  - All palette labels, buttons, and tray menu items are in Korean (AC #12).

### Work Unit F — End-to-end wiring + E2E verification  *(integration; depends on B-E)*
- Wire hotkey -> two-phase assemble -> LLM -> palette -> action across IPC.
- **IDE extension E2E bootstrapping**: build the `.vsix` via `vsce package` in
  `packages/ide-extension/`, install into both Cursor and VSCode via
  `code --install-extension ./wdiot-ide-extension-0.1.0.vsix` (and the equivalent `cursor`
  CLI if available, else manual install). Confirm the extension reads
  `~/Library/Application Support/wdiot/ingest.json` and successfully POSTs to the daemon's
  dynamic port with the correct token.
- **Acceptance:**
  - Full loop works — hotkey produces a real inferred intent in Korean; `[관련 탭 열기]` actually
    re-opens tabs (only tabs that were in the captured window); `[타임라인 보기]` opens the
    timeline.
  - Phase-1 evidence appears instantly; phase-2 intent fills after LLM round-trip.
  - Capture health is visible in the tray.
  - Extension-reported `file_edit` events flow end-to-end from Cursor/VSCode through the
    ingest server into SQLite and appear in the context window and palette.

---

## Verification — mapped to Acceptance Criteria

| # | Acceptance Criterion | Verification |
|---|----------------------|--------------|
| 1 | Menu-bar app always running with WDIOT icon | Launch app; tray icon visible; survives 30 min idle; survives sleep/wake. |
| 2 | Background tracker records app switches to SQLite with timestamps | Switch apps 10 times; query `activities` for `app_switch` rows; assert each has correct `ts` (within 2 s of wall clock) and edge-triggered (no duplicates for staying on one app). |
| 3 | Browser activity (tabs, URLs, parsed searches) via AppleScript for Chrome/Safari | Open 3 tabs in Chrome + search "test query" in Safari; verify `browser_tab` rows (url, title, active) + `search` row (engine, query parsed from URL). |
| 4 | IDE extension reports workspace/active file/recent files/cursor/git-diff | Edit a file in Cursor; open 3 files in VSCode; verify `file_edit` payload: `workspacePath`, `filePath`, `recentFiles` (>= 1), `cursorLine` (integer), `hasGitDiff` (boolean). Confirm no `payload` field references Cursor AI chat. |
| 5 | Global hotkey opens the palette | Press `Cmd+Shift+W`; palette window appears. **If registration fails** (tested by temporarily registering the same shortcut from another app first), verify the tray menu shows "단축키 충돌: Cmd+Shift+W가 다른 앱에서 사용 중입니다" and palette does not silently fail. |
| 6 | Hotkey assembles last N min and sends to cloud LLM | **Tool:** run `sudo tcpdump -i lo0 -c 50 -w /tmp/wdiot-capture.pcap` (or `mitmproxy` on the outbound interface) before the test session. **Procedure:** (a) Let capture run for 5 minutes of normal activity (idle tracking phase). (b) Verify zero outbound connections to `api.anthropic.com` / `api.openai.com` during this idle window. (c) Press the hotkey. (d) Verify exactly one outbound request to the configured LLM endpoint. (e) Inspect the request body (via mitmproxy or the daemon's debug log): assert it contains the assembled ContextWindow digest and nothing else (no raw activities, no API key in the body, no settings). |
| 7 | Palette shows 3-part result | Inspect rendered DOM: IntentLine (single `<p>` or `<h2>`), EvidenceList (`<ul>` with 2-4 `<li>`), ResumeActions (1-3 `<button>` elements). |
| 8 | Resume actions are executable | Click `[관련 탭 열기]` -> verify tabs reopen in the default browser (only URLs from the captured window). `[타임라인 보기]` -> verify the timeline window opens with the correct time range. |
| 9 | Intent reads as inference, not a log (Korean output) | **Automated gate (vitest):** `golden-cases.ts` in `__fixtures__/` defines 3-5 scenarios, each a (seeded timeline -> IntentResult). Expected `intent.summary` values in the golden fixtures are written in Korean (e.g. "아마 Chart.js 주석 오프셋 버그를 고치고 있었을 거예요, 줌 인터랙션 코드를 확인한 이후에."). A test suite validates: (a) `prompt.ts` output shape: system prompt is present, contains the Korean-output directive ("모든 텍스트 출력은 반드시 한국어로 작성하세요"), user content contains the digest, response schema is attached. (b) The `IntentResultSchema` (zod) enforces: `intent.summary` is a non-empty string. **Documented manual rubric** (applied by a human reviewer to 5 real Korean LLM outputs): the summary (i) is a single Korean sentence; (ii) names a goal or intent verb (e.g. "고치고", "조사하고", "구현하고"); (iii) includes a causal/temporal clause ("~이후에", "~하면서", "~때문에"); (iv) does NOT contain an enumerated raw-activity list (no "1. X를 열었음, 2. Y를 검색함" pattern). At least 4 of 5 outputs must pass all four rubric criteria. |
| 10 | Cursor AI chat never collected | Static code review of `collector.ts`: grep for `chat`, `copilot`, `inlineChat`, `aiChat` API surfaces — zero hits. Only public VSCode APIs (`workspace.workspaceFolders`, `window.activeTextEditor`, `workspace.textDocuments`, `TextEditor.selection`). |
| 11 | Data leaves only on hotkey press, never streaming | **Tool + procedure:** Same `tcpdump`/`mitmproxy` setup as AC #6. **Idle monitoring duration:** 10 minutes of active use (switching apps, browsing, editing in IDE) without pressing the hotkey. **Assertion:** zero packets to any LLM API endpoint (`api.anthropic.com`, `api.openai.com`). Only local-loopback traffic (127.0.0.1, ingest server) is permitted. After the idle window, press the hotkey and confirm exactly one LLM API request as in AC #6. |
| 12 | All user-facing text is Korean | **Automated gate (vitest):** verify `prompt.ts` system prompt contains the Korean-output directive string. **Manual check:** inspect tray menu (종료, 설정, 타임라인 보기, 수집 상태), palette labels (생각하는 중..., 최근 활동:, 다시 시도), palette LLM output (intent summary, evidence bullets, action labels) — all Korean. Verify JSON keys in LLM response remain English (`intent`, `evidence`, `actions`). |

Test layers:
- `vitest` unit tests for `compressor.ts`, `assembler.ts` (including sleep/wake gap scenario),
  URL->search parsing, `zod` LLM-response validation, `validators.ts` (URL allowlist, path
  cross-check, tab cap), and the golden-case prompt shape checks.
- All unit tests use the shared seeded timeline fixture from
  `packages/daemon/src/main/context/__fixtures__/seed-timeline.ts`.
- Manual macOS integration checks for capture, permissions, and LLM output quality (capture
  sources cannot be meaningfully unit-tested off a real desktop).

---

## Risks + Mitigations

| Risk | Mitigation |
|------|------------|
| macOS Accessibility/Automation permission prompts block capture | Per-source health state machine (`capture/health.ts`); persistent `denied` state surfaces a tray warning with System Settings deep-link. Handles first-run, mid-session revocation, and partial grants (Chrome ok / Safari denied). Degrades gracefully — captures what is allowed. |
| AppleScript fragility (browser version drift, script errors) | Isolate all AppleScript in `scripts/` + a single `applescript.ts` runner with timeout/abort; transient failures skip the tick; persistent failures escalate via health state machine. |
| LLM latency/cost on hotkey press | Two-phase palette paint: local evidence < 100 ms, LLM fills asynchronously. Single-call design; bounded/compressed digest with a hard event cap + LIMIT on the SQL query; cancel affordance; brief result cache to allow re-open without re-calling. |
| Electron always-on memory footprint | Daemon-only by default — create palette/timeline `BrowserWindow`s lazily and destroy on close; keep one main process; profile and revisit `utilityProcess` only if main-loop stalls appear. |
| Hung `osascript` stalling the capture loop | Per-call hard timeout + abort + per-source re-entrancy guard in `scheduler.ts`. |
| Other local processes hitting the loopback ingest port | Dynamic port (OS-assigned); `127.0.0.1` only; cryptographic token in discovery file (mode 0600); reject missing/wrong `Authorization` header; reject non-loopback `Host`. |
| API key leak | Stored in macOS Keychain (not plaintext JSON); never logged; never included in the assembled digest; never sent to the renderer. |
| LLM suggests malicious/unintended actions | `actions/validators.ts`: URL scheme allowlist (`http`/`https` only), cross-check every URL/path against the captured ContextWindow, cap `open_tabs` at 10. Mismatched items silently dropped; fully-empty actions disabled with tooltip. |
| Context window after sleep/wake is empty or stale | `assembler.ts` detects gaps > 5 min; anchors the effective window to the post-gap activity cluster; annotates the gap for the LLM prompt. |
| globalShortcut.register fails (hotkey conflict) | Check return value; surface conflict in tray menu in Korean ("단축키 충돌: Cmd+Shift+W가 다른 앱에서 사용 중입니다"). |
| Compression stalls main event loop | `compressor.ts` runs in a `worker_threads` worker or yields via `setImmediate` between passes; capture timers and ingest server remain responsive. |

---

## Open Questions
Tracked in `.omc/plans/open-questions.md`.

## Out of Scope (restated)
No interrupt detection, no real-time intervention, no task clustering / retrospection / emotion
inference, no local LLM, no vector DB, no Cursor AI chat collection, no periodic Memory Snapshot,
no Slack/Discord/Gmail, no browsers beyond Chrome/Safari, no IDEs beyond Cursor/VSCode, no
Windows/Linux. `Task` and `Snapshot` ontology entities get no v1 code.
