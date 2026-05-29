/**
 * Shared LLM response parsing — used by both provider implementations.
 *
 * Models occasionally wrap JSON in markdown fences despite the prompt; this
 * strips a fence if present, parses, then `zod`-validates against the strict
 * `IntentResultSchema` (plan B5 step 7).
 */
import type { IntentResult } from '@wdiot/shared';
import { LlmResponseSchema } from '@wdiot/shared';

/** Strip an optional ```json ... ``` (or bare ``` ... ```) fence. */
function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
  return fenceMatch ? fenceMatch[1]!.trim() : trimmed;
}

/**
 * Parse raw model text into a validated {@link IntentResult}. Throws a
 * descriptive error when the text is not JSON or fails schema validation.
 */
export function parseIntentResult(raw: string): IntentResult {
  const cleaned = stripCodeFence(raw);

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error('LLM response was not valid JSON');
  }

  const result = LlmResponseSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `LLM response failed schema validation: ${result.error.message}`,
    );
  }

  return result.data;
}
