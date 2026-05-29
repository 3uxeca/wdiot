/**
 * Prompt builder — plan Boundary 5, phase 2 step 6.
 *
 * Builds the system + user prompt for intent reconstruction. The system prompt
 * instructs the model to INFER intent (never list activity) and to produce ALL
 * text values in Korean while keeping JSON keys English.
 *
 * `prompt.ts` is provider-agnostic: both `claude-provider.ts` and
 * `openai-provider.ts` consume {@link buildPrompt}.
 */
import type { ContextDigest } from '@wdiot/shared';
import { KOREAN_OUTPUT_DIRECTIVE } from '@wdiot/shared';

/** A built prompt: a system instruction + a user message carrying the digest. */
export interface BuiltPrompt {
  system: string;
  user: string;
}

/**
 * The system prompt. It MUST (a) instruct the model to infer intent rather than
 * enumerate activity, and (b) embed {@link KOREAN_OUTPUT_DIRECTIVE} verbatim
 * (plan AC #9 / #12 automated gates assert this exact string is present).
 */
export const SYSTEM_PROMPT = [
  '당신은 WDIOT의 작업 맥락 복원 어시스턴트입니다.',
  '사용자가 흐름을 잃었을 때, 최근 활동 다이제스트를 보고 사용자가 "무엇을 하려고 했는지" 의도를 추론합니다.',
  '',
  '핵심 원칙:',
  '1. 활동을 나열하지 말고 의도를 추론하세요. "1. X를 열었음, 2. Y를 검색함" 같은 로그 덤프는 실패입니다.',
  '2. intent.summary는 추론하는 한 문장으로 작성하세요. "아마 ~하고 있었을 거예요, ~이후에" 형태가 자연스럽습니다.',
  '3. 목표나 의도를 나타내는 동사("고치고", "조사하고", "구현하고" 등)와 인과/시간 절("~이후에", "~하면서", "~때문에")을 포함하세요.',
  '4. 다이제스트에 sleep/wake 간격(gapDetected)이 있으면, 휴식 후 돌아온 상황으로 간주하고 가장 최근 활동 클러스터에 의도를 앵커하세요.',
  '5. evidence는 다이제스트에서 도출한 2~4개의 간결한 한국어 근거 문장입니다.',
  '6. actions는 실행 가능한 재개 동작입니다. kind는 "open_tabs", "resume_work", "show_timeline" 중에서만 사용하세요.',
  '   payload는 빈 객체 {} 로 두어도 됩니다. 실제 URL/경로 검증은 다운스트림에서 수행됩니다.',
  '',
  '출력 형식: 아래 형태의 엄격한 JSON 객체 하나만 반환하세요. 마크다운 코드펜스나 설명을 덧붙이지 마세요.',
  '{',
  '  "intent": { "summary": "<한국어 추론 문장>", "confidence": <0~1 숫자> },',
  '  "evidence": ["<한국어 근거>", ...],',
  '  "actions": [{ "label": "<한국어 버튼 라벨>", "kind": "<open_tabs|resume_work|show_timeline>", "payload": {} }]',
  '}',
  '',
  KOREAN_OUTPUT_DIRECTIVE,
].join('\n');

/**
 * Render the compressed digest as a compact, human-readable block for the user
 * message. Timestamps are kept as epoch ms — the model reasons about relative
 * ordering and the gap annotation, not wall-clock formatting.
 */
function renderDigest(digest: ContextDigest): string {
  const lines: string[] = [];

  lines.push(`window_range_minutes: ${digest.rangeMinutes}`);
  lines.push(`assembled_at: ${digest.assembledAt}`);
  if (digest.truncated) {
    lines.push('truncated: true (일부 활동이 토큰 예산 때문에 생략됨)');
  }
  if (digest.gapDetected) {
    const g = digest.gapDetected;
    lines.push(
      `gap_detected: ${g.durationMin}분 간격 (from=${g.from}, to=${g.to}) — 휴식 후 복귀`,
    );
  }

  lines.push('');
  lines.push('apps (앱 사용 구간):');
  if (digest.apps.length === 0) lines.push('  (없음)');
  for (const a of digest.apps) {
    lines.push(`  - ${a.appName} [${a.from}~${a.to}]`);
  }

  lines.push('');
  lines.push('browser (방문한 탭):');
  if (digest.browser.length === 0) lines.push('  (없음)');
  for (const b of digest.browser) {
    lines.push(`  - [${b.browser}] ${b.title} — ${b.url}`);
  }

  lines.push('');
  lines.push('searches (검색 질의):');
  if (digest.searches.length === 0) lines.push('  (없음)');
  for (const s of digest.searches) {
    lines.push(`  - [${s.engine}] "${s.query}"`);
  }

  lines.push('');
  lines.push('files (IDE 파일 편집):');
  if (digest.files.length === 0) lines.push('  (없음)');
  for (const f of digest.files) {
    const cursor = f.lastCursorLine !== undefined ? ` (커서 ${f.lastCursorLine}행)` : '';
    lines.push(
      `  - ${f.filePath} — 편집 ${f.editCount}회${cursor}, gitDiff=${f.hasGitDiff}`,
    );
  }

  return lines.join('\n');
}

/**
 * Build the system + user prompt for intent reconstruction. The user message
 * carries the rendered digest; the system message carries the inference
 * directive + Korean-output directive.
 */
export function buildPrompt(digest: ContextDigest): BuiltPrompt {
  const user = [
    '아래는 사용자의 최근 작업 활동 다이제스트입니다.',
    '이 다이제스트를 보고 사용자의 의도를 추론하여 위에서 명시한 JSON 형식으로만 응답하세요.',
    '',
    '--- DIGEST START ---',
    renderDigest(digest),
    '--- DIGEST END ---',
  ].join('\n');

  return { system: SYSTEM_PROMPT, user };
}
