/**
 * IPC surface — renderer <-> main contract (plan Boundary 1).
 *
 * The palette renderer drives a TWO-PHASE flow on hotkey press:
 *
 *   Phase 1 (`palette:invoke` -> immediate return): the main process slices the
 *   local timeline, compresses it, and returns a `ContextDigest` synchronously
 *   from the renderer's perspective (target < 100 ms — pure local SQL + CPU,
 *   no LLM). The renderer paints the EvidenceList instantly.
 *
 *   Phase 2 (`palette:intent` -> pushed event): the main process calls the LLM
 *   asynchronously and pushes an `IntentResult` (or an error) to the renderer,
 *   which fills the IntentLine and renders real ResumeActions.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WIRING SEAM FOR WORK UNIT F
 * ──────────────────────────────────────────────────────────────────────────
 * This module owns the IPC channel names + payload types. The actual heavy
 * lifting (context assembly/compression, the LLM call, action execution,
 * timeline queries) belongs to Work Units B/C/D. To keep those units
 * independently developable, this file depends ONLY on a small set of async
 * function boundaries declared in `IpcBackend` below. Work Unit F supplies the
 * real implementations by calling `registerIpcHandlers(backend)` once at
 * startup with D's assembler/compressor/LLM-provider/executor wired in.
 *
 * Until F wires them, `createPlaceholderBackend()` returns a typed,
 * deterministic stub so the palette/timeline renderers are fully developable
 * and testable on their own.
 */
import { ipcMain, type BrowserWindow } from 'electron';
import type { ContextDigest, IntentResult, ResumeAction } from '@wdiot/shared';
import {
  IPC,
  type ActionRunResult,
  type PaletteIntentPush,
  type PaletteInvokeResult,
  type TimelineQueryRequest,
  type TimelineQueryResult,
} from '../ipc/contract.js';

// Re-export the Electron-free contract so importers of `./ipc` keep working;
// renderer/preload code imports directly from `../ipc/contract`.
export {
  IPC,
  type ActionRunResult,
  type PaletteIntentPush,
  type PaletteInvokeResult,
  type TimelineQueryRequest,
  type TimelineQueryResult,
};

// ---------------------------------------------------------------------------
// Backend seam — Work Unit F supplies the real implementations.
// ---------------------------------------------------------------------------

/**
 * The async function boundary this IPC layer calls into. Work Unit F builds a
 * concrete `IpcBackend` from Work Unit D's modules:
 *
 *   - `assembleDigest`     -> context/assembler.ts + context/compressor.ts
 *   - `reconstructIntent`  -> llm/provider.ts (claude-provider.ts)
 *   - `runAction`          -> actions/executor.ts + actions/validators.ts
 *   - `queryTimeline`      -> storage/activity-repo.ts (sliceActivities)
 *
 * Each method is async and side-effect isolated so the renderers and this IPC
 * layer can be built and tested before B/C/D land.
 */
export interface IpcBackend {
  /** Phase 1: slice + compress the local timeline. Must stay LLM-free. */
  assembleDigest(): Promise<ContextDigest>;
  /** Phase 2: call the LLM and return a validated `IntentResult`. */
  reconstructIntent(
    digest: ContextDigest,
    signal: AbortSignal,
  ): Promise<IntentResult>;
  /** Validate + execute a resume action. */
  runAction(action: ResumeAction): Promise<ActionRunResult>;
  /** Query activities for the timeline window. */
  queryTimeline(request: TimelineQueryRequest): Promise<TimelineQueryResult>;
}

/**
 * Deterministic placeholder backend used until Work Unit F wires D's modules.
 * It produces a small, valid digest and intent so the palette/timeline UI is
 * fully developable and visually verifiable in `electron-vite dev`.
 */
export function createPlaceholderBackend(): IpcBackend {
  const now = Date.now();
  return {
    async assembleDigest(): Promise<ContextDigest> {
      return {
        rangeMinutes: 30,
        assembledAt: now,
        apps: [
          { appName: 'Cursor', from: now - 25 * 60_000, to: now - 8 * 60_000 },
          { appName: 'Google Chrome', from: now - 8 * 60_000, to: now },
        ],
        browser: [
          {
            browser: 'chrome',
            url: 'https://www.chartjs.org/docs/latest/',
            title: 'Chart.js | 문서',
            lastVisitTs: now - 6 * 60_000,
          },
        ],
        searches: [
          {
            browser: 'chrome',
            engine: 'Google',
            query: 'chartjs annotation zoom',
            url: 'https://www.google.com/search?q=chartjs+annotation+zoom',
            ts: now - 7 * 60_000,
          },
        ],
        files: [
          {
            workspacePath: '/Users/me/proj',
            filePath: 'src/QueueChart.tsx',
            editCount: 4,
            lastCursorLine: 88,
            hasGitDiff: true,
          },
        ],
        truncated: false,
      };
    },
    async reconstructIntent(): Promise<IntentResult> {
      // Simulate LLM latency so the renderer's phase-2 skeleton is observable.
      await new Promise((r) => setTimeout(r, 800));
      return {
        intent: {
          summary:
            '아마 Chart.js 주석 오프셋 버그를 고치고 있었을 거예요, 줌 인터랙션 코드를 확인한 이후에.',
          confidence: 0.82,
        },
        evidence: [
          'QueueChart.tsx를 수정했어요',
          "'chartjs annotation zoom'을 검색했어요",
          'Chart.js 문서를 확인했어요',
        ],
        actions: [
          { label: '작업 이어가기', kind: 'resume_work', payload: {} },
          { label: '관련 탭 열기', kind: 'open_tabs', payload: {} },
          { label: '타임라인 보기', kind: 'show_timeline', payload: {} },
        ],
      };
    },
    async runAction(): Promise<ActionRunResult> {
      return { ok: true };
    },
    async queryTimeline(): Promise<TimelineQueryResult> {
      return { activities: [] };
    },
  };
}

// ---------------------------------------------------------------------------
// Handler registration.
// ---------------------------------------------------------------------------

/** Tracks in-flight phase-2 LLM calls so they can be cancelled on re-invoke. */
const inflightIntent = new Map<string, AbortController>();

let nextRequestSeq = 0;

/** Generate a process-unique correlation id for a palette invocation. */
function newRequestId(): string {
  nextRequestSeq += 1;
  return `palette-${Date.now()}-${nextRequestSeq}`;
}

/**
 * Register every `ipcMain` handler against the supplied backend.
 *
 * Call once after `app.whenReady()` (Work Unit F). `getPaletteWindow` is used to
 * locate the live palette `BrowserWindow` for the phase-2 `palette:intent` push;
 * it returns `null` when the palette is closed (the push is then dropped).
 */
export function registerIpcHandlers(
  backend: IpcBackend,
  getPaletteWindow: () => BrowserWindow | null,
): void {
  // --- palette:invoke — two-phase ------------------------------------------
  ipcMain.handle(IPC.PALETTE_INVOKE, async (): Promise<PaletteInvokeResult> => {
    const requestId = newRequestId();

    // Phase 1 — local digest, returned immediately.
    const digest = await backend.assembleDigest();

    // Phase 2 — kick the LLM call off without blocking the phase-1 return.
    const controller = new AbortController();
    inflightIntent.get(requestId)?.abort();
    inflightIntent.set(requestId, controller);

    void backend
      .reconstructIntent(digest, controller.signal)
      .then((result) => {
        emitIntent(getPaletteWindow(), { requestId, ok: true, result });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return; // superseded — stay silent
        emitIntent(getPaletteWindow(), {
          requestId,
          ok: false,
          error: errorMessage(err),
        });
      })
      .finally(() => {
        if (inflightIntent.get(requestId) === controller) {
          inflightIntent.delete(requestId);
        }
      });

    return { requestId, digest };
  });

  // --- action:run ----------------------------------------------------------
  ipcMain.handle(
    IPC.ACTION_RUN,
    async (_event, action: ResumeAction): Promise<ActionRunResult> => {
      try {
        return await backend.runAction(action);
      } catch (err: unknown) {
        return { ok: false, message: errorMessage(err) };
      }
    },
  );

  // --- timeline:query ------------------------------------------------------
  ipcMain.handle(
    IPC.TIMELINE_QUERY,
    async (
      _event,
      request: TimelineQueryRequest = {},
    ): Promise<TimelineQueryResult> => {
      return backend.queryTimeline(request);
    },
  );
}

/** Remove every handler this module registered (called on quit / teardown). */
export function unregisterIpcHandlers(): void {
  for (const controller of inflightIntent.values()) controller.abort();
  inflightIntent.clear();
  ipcMain.removeHandler(IPC.PALETTE_INVOKE);
  ipcMain.removeHandler(IPC.ACTION_RUN);
  ipcMain.removeHandler(IPC.TIMELINE_QUERY);
}

/** Push a phase-2 `palette:intent` event to the palette window, if open. */
function emitIntent(
  paletteWindow: BrowserWindow | null,
  push: PaletteIntentPush,
): void {
  if (!paletteWindow || paletteWindow.isDestroyed()) return;
  paletteWindow.webContents.send(IPC.PALETTE_INTENT, push);
}

/** Normalize an unknown thrown value into a Korean-safe error string. */
function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return '알 수 없는 오류가 발생했습니다.';
}
