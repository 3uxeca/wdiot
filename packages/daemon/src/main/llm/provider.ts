/**
 * Pluggable LLM provider interface — plan "Pluggable LLM Provider Interface".
 *
 * A single `reconstructIntent` call turns a compressed `ContextDigest` into a
 * validated `IntentResult`. `createLlmProvider` is the factory: swapping
 * Claude <-> OpenAI is a one-line settings change, no other code changes.
 */
import type { ContextDigest, IntentResult, LlmProviderId } from '@wdiot/shared';
import { ClaudeProvider } from './claude-provider.js';
import { OpenAiProvider } from './openai-provider.js';

/**
 * Resolved default models (plan Open Question decision):
 *  - Claude:  `claude-sonnet-4-6`
 *  - OpenAI:  `gpt-4o`
 * The model is overridable via settings; these are the fallbacks.
 */
export const PROVIDER_DEFAULT_MODELS: Record<LlmProviderId, string> = {
  claude: 'claude-sonnet-4-6',
  openai: 'gpt-4o',
};

/** Input to a single intent-reconstruction call. */
export interface ReconstructIntentInput {
  digest: ContextDigest;
  /** abort signal — wired to the palette's cancel affordance. */
  signal?: AbortSignal;
}

/** A pluggable LLM provider. Implementations live in `*-provider.ts`. */
export interface LlmProvider {
  readonly id: LlmProviderId;
  /** Single-call intent reconstruction. Returns a strict, validated result. */
  reconstructIntent(input: ReconstructIntentInput): Promise<IntentResult>;
}

/** Configuration for {@link createLlmProvider}. */
export interface LlmProviderConfig {
  provider: LlmProviderId;
  apiKey: string;
  /** override the provider default model (see {@link PROVIDER_DEFAULT_MODELS}). */
  model?: string;
}

/**
 * Construct an {@link LlmProvider} for the configured vendor. The model
 * defaults to {@link PROVIDER_DEFAULT_MODELS} when `cfg.model` is unset.
 */
export function createLlmProvider(cfg: LlmProviderConfig): LlmProvider {
  const model = cfg.model ?? PROVIDER_DEFAULT_MODELS[cfg.provider];

  switch (cfg.provider) {
    case 'claude':
      return new ClaudeProvider(cfg.apiKey, model);
    case 'openai':
      return new OpenAiProvider(cfg.apiKey, model);
    default: {
      const exhaustive: never = cfg.provider;
      throw new Error(`unknown LLM provider: ${String(exhaustive)}`);
    }
  }
}
