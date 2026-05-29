/**
 * OpenAI LLM provider — the swappable alternative (plan Guardrails).
 *
 * Same contract as `claude-provider.ts`: builds the prompt via `prompt.ts`,
 * requests a JSON object response, and `zod`-validates before returning.
 */
import OpenAI from 'openai';
import type { IntentResult } from '@wdiot/shared';
import type { LlmProvider, ReconstructIntentInput } from './provider.js';
import { buildPrompt } from './prompt.js';
import { parseIntentResult } from './parse-response.js';

/** {@link LlmProvider} backed by the OpenAI Chat Completions API. */
export class OpenAiProvider implements LlmProvider {
  readonly id = 'openai' as const;

  private readonly client: OpenAI;

  constructor(
    apiKey: string,
    private readonly model: string,
  ) {
    this.client = new OpenAI({ apiKey });
  }

  async reconstructIntent(input: ReconstructIntentInput): Promise<IntentResult> {
    const { system, user } = buildPrompt(input.digest);

    const response = await this.client.chat.completions.create(
      {
        model: this.model,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      },
      { signal: input.signal },
    );

    const text = response.choices[0]?.message?.content?.trim();
    if (!text) {
      throw new Error('OpenAI returned an empty response');
    }

    return parseIntentResult(text);
  }
}
