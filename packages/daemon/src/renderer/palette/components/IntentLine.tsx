/**
 * IntentLine — the one-line inferred intent (palette result region 1).
 *
 * Phase 1: shows a shimmer skeleton with the Korean placeholder
 * "생각하는 중...". Phase 2: filled with the LLM's inferred Korean sentence
 * plus an optional subtle confidence indicator. Renders as a single sentence,
 * never a bullet list (plan Palette Result Rendering Contract).
 */
import type { JSX } from 'react';
import type { Intent } from '@wdiot/shared';
import { Skeleton } from '../../shared-ui/index.js';

export interface IntentLineProps {
  /** the inferred intent once phase 2 resolves; `null` while loading */
  intent: Intent | null;
  /** true while the LLM call is in flight */
  loading: boolean;
}

/** Korean placeholder shown while the LLM reconstructs intent. */
const THINKING_PLACEHOLDER = '생각하는 중...';

/** Render the inferred intent line. */
export function IntentLine({ intent, loading }: IntentLineProps): JSX.Element {
  if (intent) {
    return (
      <div data-testid="intent-line" className="space-y-1">
        <p className="text-base font-medium leading-snug text-slate-50">
          {intent.summary}
        </p>
        <p
          data-testid="intent-confidence"
          className="text-xs text-slate-500"
        >
          확신도 {Math.round(intent.confidence * 100)}%
        </p>
      </div>
    );
  }

  // Phase 1 — shimmer skeleton + the Korean "thinking" placeholder.
  return (
    <div data-testid="intent-line" className="space-y-2">
      <p
        data-testid="intent-thinking"
        className="flex items-center gap-2 text-sm text-slate-400"
        aria-live="polite"
        aria-busy={loading}
      >
        <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-sky-400" />
        {THINKING_PLACEHOLDER}
      </p>
      <Skeleton testId="intent-skeleton" className="h-4 w-4/5" />
    </div>
  );
}
