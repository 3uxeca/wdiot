/**
 * LLM request/response contract.
 *
 * The daemon sends a compressed `ContextDigest` to a pluggable LLM provider and
 * expects a strict JSON response matching `IntentResultSchema`. JSON keys are
 * always English; only the string *values* are Korean (plan Guardrails).
 */
import { z } from 'zod';
import { ContextDigestSchema, IntentResultSchema, type ContextDigest } from './context.js';

/** Identifies which provider implementation to use. */
export type LlmProviderId = 'claude' | 'openai';

export const LlmProviderIdSchema = z.enum(['claude', 'openai']);

/**
 * Provider-agnostic request shape passed into `LlmProvider.reconstructIntent`.
 * The provider turns this into a vendor-specific API call via `prompt.ts`.
 */
export interface LlmRequest {
  digest: ContextDigest;
  /** override the provider default model, when set */
  model?: string;
}

export const LlmRequestSchema = z.object({
  digest: ContextDigestSchema,
  model: z.string().optional(),
});

/**
 * Strict JSON response the LLM is instructed to return. Identical in shape to
 * `IntentResult` — re-exported here as the canonical "what the model must emit"
 * schema so providers can `zod`-validate before returning.
 */
export const LlmResponseSchema = IntentResultSchema;

export type LlmResponse = z.infer<typeof LlmResponseSchema>;

/**
 * The Korean-output directive the prompt builder MUST embed in the system
 * prompt (plan AC #9 / #12 automated gate checks for this exact string).
 */
export const KOREAN_OUTPUT_DIRECTIVE =
  '모든 텍스트 출력은 반드시 한국어로 작성하세요. JSON 키 이름은 영어를 유지합니다.';

/** Default models per provider. */
export const DEFAULT_MODELS: Record<LlmProviderId, string> = {
  claude: 'claude-sonnet-4-5',
  openai: 'gpt-4o',
};
