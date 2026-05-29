/**
 * Claude (Anthropic SDK) LLM provider — the default (plan Guardrails).
 *
 * Builds the prompt via `prompt.ts`, requests a JSON-only response, and
 * `zod`-validates the result before returning (plan B5 step 7).
 */
import Anthropic from '@anthropic-ai/sdk';
import type { IntentResult } from '@wdiot/shared';
import type { LlmProvider, ReconstructIntentInput } from './provider.js';
import { buildPrompt } from './prompt.js';
import { parseIntentResult } from './parse-response.js';

/** Max tokens for the intent-reconstruction completion. */
const MAX_TOKENS = 1024;

/** {@link LlmProvider} backed by the Anthropic Messages API. */
export class ClaudeProvider implements LlmProvider {
  readonly id = 'claude' as const;

  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    private readonly model: string,
  ) {
    this.client = new Anthropic({ apiKey });
  }

  async reconstructIntent(input: ReconstructIntentInput): Promise<IntentResult> {
    const { system, user } = buildPrompt(input.digest);

    const response = await this.client.messages.create(
      {
        model: this.model,
        max_tokens: MAX_TOKENS,
        system,
        messages: [{ role: 'user', content: user }],
      },
      { signal: input.signal },
    );

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('')
      .trim();

    if (!text) {
      throw new Error('Claude returned an empty response');
    }

    return parseIntentResult(text);
  }
}
