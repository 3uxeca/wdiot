/**
 * EvidenceList — minimal evidence bullets (palette result region 2).
 *
 * Phase 1: painted immediately from the local digest (Korean header
 * "최근 활동:"). Phase 2: refined in place with the LLM's curated evidence.
 * Always 2-4 bullets; pure presentation.
 */
import type { JSX } from 'react';

export interface EvidenceListProps {
  /** Korean evidence bullets (local in phase 1, LLM-curated in phase 2) */
  bullets: string[];
}

/** Korean section header for the evidence region. */
const EVIDENCE_HEADER = '최근 활동:';

/** Render the evidence bullet list. */
export function EvidenceList({ bullets }: EvidenceListProps): JSX.Element {
  return (
    <section data-testid="evidence-list" className="space-y-1.5">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {EVIDENCE_HEADER}
      </h2>
      {bullets.length === 0 ? (
        <p data-testid="evidence-empty" className="text-sm text-slate-500">
          최근 활동을 찾지 못했어요.
        </p>
      ) : (
        <ul className="space-y-1">
          {bullets.map((bullet, index) => (
            <li
              key={`${index}-${bullet}`}
              className="flex gap-2 text-sm text-slate-300"
            >
              <span aria-hidden className="text-slate-600">
                ·
              </span>
              <span>{bullet}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
