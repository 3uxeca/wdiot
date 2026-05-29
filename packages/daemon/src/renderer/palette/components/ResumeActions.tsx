/**
 * ResumeActions — executable resume action buttons (palette result region 3).
 *
 * Phase 1: skeleton/disabled button placeholders. Phase 2: real buttons, one
 * per `ResumeAction`, with Korean labels (e.g. [작업 이어가기] [관련 탭 열기]
 * [타임라인 보기]). Clicking dispatches the action; the parent owns IPC.
 */
import type { JSX } from 'react';
import type { ResumeAction } from '@wdiot/shared';
import { Skeleton } from '../../shared-ui/index.js';

export interface ResumeActionsProps {
  /** the LLM-curated actions once phase 2 resolves; `null` while loading */
  actions: ResumeAction[] | null;
  /** invoked when the user clicks an action button */
  onRun: (action: ResumeAction) => void;
  /** kind currently executing (button shows a busy state); `null` if idle */
  runningKind: ResumeAction['kind'] | null;
}

/** Number of skeleton buttons shown during phase 1. */
const PHASE1_SKELETON_COUNT = 3;

/** Render the resume-action buttons (or their phase-1 skeletons). */
export function ResumeActions({
  actions,
  onRun,
  runningKind,
}: ResumeActionsProps): JSX.Element {
  if (!actions) {
    // Phase 1 — skeleton button placeholders.
    return (
      <div
        data-testid="resume-actions-skeleton"
        className="flex flex-wrap gap-2"
      >
        {Array.from({ length: PHASE1_SKELETON_COUNT }).map((_, index) => (
          <Skeleton key={index} className="h-9 w-28" />
        ))}
      </div>
    );
  }

  return (
    <div data-testid="resume-actions" className="flex flex-wrap gap-2">
      {actions.map((action) => {
        const busy = runningKind === action.kind;
        return (
          <button
            key={action.kind}
            type="button"
            data-testid={`action-${action.kind}`}
            disabled={runningKind !== null}
            onClick={() => onRun(action)}
            className="rounded-md bg-sky-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? '실행 중...' : action.label}
          </button>
        );
      })}
    </div>
  );
}
