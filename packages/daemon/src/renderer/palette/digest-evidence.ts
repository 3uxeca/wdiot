/**
 * Phase-1 local evidence derivation.
 *
 * Turns the locally-assembled `ContextDigest` into 2-4 Korean evidence bullets
 * the palette paints instantly — these are facts, not inferences. Phase 2
 * replaces them with the LLM's curated evidence.
 */
import type { ContextDigest } from '@wdiot/shared';

/** Strip a path down to its basename for compact display. */
function basename(path: string): string {
  const parts = path.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

/**
 * Derive up to `max` Korean evidence bullets from the local digest. Ordering
 * favors the most intent-revealing signals: edited files, then searches, then
 * browser visits, then app spans.
 */
export function localEvidenceBullets(
  digest: ContextDigest,
  max = 4,
): string[] {
  const bullets: string[] = [];

  for (const file of digest.files) {
    bullets.push(`${basename(file.filePath)}를 수정했어요`);
  }
  for (const search of digest.searches) {
    bullets.push(`'${search.query}'을 검색했어요`);
  }
  for (const visit of digest.browser) {
    const label = visit.title.trim() || visit.url;
    bullets.push(`${label} 페이지를 봤어요`);
  }
  for (const span of digest.apps) {
    bullets.push(`${span.appName}을 사용했어요`);
  }

  return bullets.slice(0, max);
}
