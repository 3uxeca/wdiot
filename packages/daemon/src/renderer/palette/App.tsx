/**
 * Palette renderer — the two-phase paint (plan Palette Result Rendering
 * Contract).
 *
 * Phase 1 (instant, < 100 ms target): on open the renderer calls
 * `window.wdiot.invoke()`, which returns the local `ContextDigest`. It paints
 * the `EvidenceList` immediately from locally-derived bullets, shows the
 * `IntentLine` shimmer ("생각하는 중...") and `ResumeActions` skeletons.
 *
 * Phase 2 (async, ~1-5 s): the main process pushes `palette:intent`. The
 * renderer fills the `IntentLine`, refines the `EvidenceList` with the LLM's
 * curated evidence, and renders real `ResumeActions` buttons.
 *
 * Error state: the LLM phase can fail. The palette keeps the phase-1 evidence
 * visible and shows a Korean error banner with a "다시 시도" retry button.
 */
import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import type {
  ContextDigest,
  Intent,
  ResumeAction,
} from '@wdiot/shared';
import type { PaletteIntentPush } from '../../ipc/contract.js';
import { paletteBridge } from './bridge.js';
import { EvidenceList, IntentLine, ResumeActions } from './components/index.js';
import { localEvidenceBullets } from './digest-evidence.js';

/** Phase-2 lifecycle of the palette. */
type IntentPhase =
  | { status: 'loading' }
  | { status: 'ready'; intent: Intent; evidence: string[]; actions: ResumeAction[] }
  | { status: 'error'; message: string };

/** The palette root component. */
export function App(): JSX.Element {
  /** Phase-1 local digest; `null` until `invoke()` resolves. */
  const [digest, setDigest] = useState<ContextDigest | null>(null);
  /** Phase-1 invoke failure (rare — local SQL); Korean message. */
  const [invokeError, setInvokeError] = useState<string | null>(null);
  /** Phase-2 LLM lifecycle. */
  const [phase, setPhase] = useState<IntentPhase>({ status: 'loading' });
  /** Action kind currently executing; `null` when idle. */
  const [runningKind, setRunningKind] = useState<ResumeAction['kind'] | null>(
    null,
  );

  /** Correlation id of the in-flight invocation — guards stale phase-2 pushes. */
  const requestIdRef = useRef<string | null>(null);

  /** Run one full two-phase invocation (initial open + "다시 시도" retry). */
  const invoke = useCallback(async (): Promise<void> => {
    setInvokeError(null);
    setPhase({ status: 'loading' });
    try {
      const { requestId, digest: localDigest } = await paletteBridge().invoke();
      requestIdRef.current = requestId;
      setDigest(localDigest);
    } catch {
      setInvokeError('최근 활동을 불러오지 못했습니다.');
      setPhase({ status: 'error', message: '최근 활동을 불러오지 못했습니다.' });
    }
  }, []);

  // Subscribe to the phase-2 `palette:intent` push for the lifetime of the
  // window, and kick off the first invocation.
  useEffect(() => {
    const unsubscribe = paletteBridge().onIntent((push: PaletteIntentPush) => {
      // Drop pushes that belong to a superseded invocation.
      if (push.requestId !== requestIdRef.current) return;
      if (push.ok) {
        setPhase({
          status: 'ready',
          intent: push.result.intent,
          evidence: push.result.evidence,
          actions: push.result.actions,
        });
      } else {
        setPhase({ status: 'error', message: push.error });
      }
    });

    void invoke();
    return unsubscribe;
  }, [invoke]);

  /** Dispatch a resume action over IPC. */
  const handleRun = useCallback(async (action: ResumeAction): Promise<void> => {
    setRunningKind(action.kind);
    try {
      await paletteBridge().runAction(action);
    } finally {
      setRunningKind(null);
    }
  }, []);

  // --- derive what each region renders -------------------------------------

  const intentReady = phase.status === 'ready';
  const intent: Intent | null = intentReady ? phase.intent : null;

  // Evidence: LLM-curated bullets once phase 2 is ready, else local bullets.
  const evidenceBullets: string[] = intentReady
    ? phase.evidence
    : digest
      ? localEvidenceBullets(digest)
      : [];

  const actions: ResumeAction[] | null = intentReady ? phase.actions : null;
  const showError = phase.status === 'error';

  return (
    <main
      data-testid="palette-root"
      className="flex h-screen flex-col gap-4 rounded-xl bg-slate-900/95 p-5 text-slate-100 shadow-2xl ring-1 ring-white/10"
    >
      <header className="flex items-baseline justify-between">
        <h1 className="text-sm font-semibold text-slate-300">왜켰더라</h1>
        <span className="text-xs text-slate-600">WDIOT</span>
      </header>

      {/* Region 1 — inferred intent. */}
      <IntentLine intent={intent} loading={phase.status === 'loading'} />

      {/* Region 2 — evidence (painted instantly in phase 1). */}
      <EvidenceList bullets={evidenceBullets} />

      {/* Error banner — keeps phase-1 evidence visible, offers a retry. */}
      {showError && (
        <div
          data-testid="palette-error"
          role="alert"
          className="flex items-center justify-between gap-3 rounded-md bg-rose-950/70 px-3 py-2 ring-1 ring-rose-800/60"
        >
          <span className="text-sm text-rose-200">
            의도를 분석하지 못했어요.
          </span>
          <button
            type="button"
            data-testid="palette-retry"
            onClick={() => void invoke()}
            className="rounded bg-rose-700 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-rose-600"
          >
            다시 시도
          </button>
        </div>
      )}

      {/* Region 3 — executable resume actions. */}
      {!showError && (
        <ResumeActions
          actions={actions}
          onRun={(action) => void handleRun(action)}
          runningKind={runningKind}
        />
      )}

      {/* Phase-1 invoke failure (local SQL failed before any digest). */}
      {invokeError && !showError && (
        <p data-testid="palette-invoke-error" className="text-xs text-rose-300">
          {invokeError}
        </p>
      )}
    </main>
  );
}
