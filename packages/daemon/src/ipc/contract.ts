/**
 * IPC contract — channel names + payload types shared across the IPC boundary.
 *
 * This module is intentionally Electron-free so it can be imported by all three
 * layers without dragging `electron` into the renderer's type graph:
 *
 *   - `main/ipc.ts`            — registers `ipcMain` handlers
 *   - `preload/*-preload.ts`   — wraps `ipcRenderer` behind `contextBridge`
 *   - `renderer/**`            — consumes the typed `window.wdiot` bridge
 *
 * Keeping the contract here is the explicit wiring seam: Work Unit F implements
 * the `IpcBackend` (see `main/ipc.ts`) without ever touching these types.
 */
import type {
  Activity,
  ContextDigest,
  IntentResult,
  ResumeAction,
} from '@wdiot/shared';

// ---------------------------------------------------------------------------
// IPC channel names — single source of truth for preload and main.
// ---------------------------------------------------------------------------

export const IPC = {
  /** renderer -> main (invoke): phase 1, returns the local `ContextDigest`. */
  PALETTE_INVOKE: 'palette:invoke',
  /** main -> renderer (event): phase 2, pushes the `IntentResult` or an error. */
  PALETTE_INTENT: 'palette:intent',
  /** renderer -> main (invoke): validate + execute a `ResumeAction`. */
  ACTION_RUN: 'action:run',
  /** renderer -> main (invoke): query activities for the timeline window. */
  TIMELINE_QUERY: 'timeline:query',
} as const;

// ---------------------------------------------------------------------------
// Payload types crossing the IPC boundary.
// ---------------------------------------------------------------------------

/** Phase-1 response of `palette:invoke`. */
export interface PaletteInvokeResult {
  /** correlation id tying the phase-1 digest to the phase-2 `palette:intent`. */
  requestId: string;
  /** the local compressed digest — painted immediately by the renderer. */
  digest: ContextDigest;
}

/** Phase-2 push payload on `palette:intent` — discriminated on `ok`. */
export type PaletteIntentPush =
  | { requestId: string; ok: true; result: IntentResult }
  | { requestId: string; ok: false; error: string };

/** Result of an `action:run` invocation. */
export interface ActionRunResult {
  ok: boolean;
  /** Korean, user-facing detail when `ok` is false. */
  message?: string;
}

/** Request payload for `timeline:query`. */
export interface TimelineQueryRequest {
  /** epoch ms lower bound; defaults to `now - 24h` when omitted. */
  sinceTs?: number;
}

/** Result payload for `timeline:query`. */
export interface TimelineQueryResult {
  activities: Activity[];
}

// ---------------------------------------------------------------------------
// Renderer-facing bridge API surfaces (`window.wdiot`).
//
// These describe the exact, minimal API each preload installs via
// `contextBridge`. Declaring them here — Electron-free — lets the renderers
// type `window.wdiot` without importing the preload modules (which depend on
// `electron`).
// ---------------------------------------------------------------------------

/** Unsubscribe handle returned by `PaletteApi.onIntent`. */
export type Unsubscribe = () => void;

/** Typed API exposed to the palette renderer as `window.wdiot`. */
export interface PaletteApi {
  /** WDIOT app name, for display. */
  readonly appName: string;
  /**
   * Phase 1: ask the main process to assemble + return the local digest.
   * Resolves fast (target < 100 ms) — no LLM on this path.
   */
  invoke(): Promise<PaletteInvokeResult>;
  /**
   * Phase 2: subscribe to the asynchronous `palette:intent` push. The callback
   * fires once per invocation with either the `IntentResult` or an error.
   * Returns an unsubscribe function.
   */
  onIntent(callback: (push: PaletteIntentPush) => void): Unsubscribe;
  /** Validate + execute a resume action in the main process. */
  runAction(action: ResumeAction): Promise<ActionRunResult>;
}

/** Typed API exposed to the timeline renderer as `window.wdiot`. */
export interface TimelineApi {
  /** WDIOT app name, for display. */
  readonly appName: string;
  /** Query activities for the timeline window. */
  query(request?: TimelineQueryRequest): Promise<TimelineQueryResult>;
}
