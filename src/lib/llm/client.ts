import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { env } from '@/lib/env';
import { fenceUntrusted, untrustedContentDirective } from './untrusted';

/**
 * The only path from this application to a model (spec §2, §3.2).
 *
 * Two rules are enforced structurally rather than by convention:
 *
 *   - Every call is function-calling with `strict: true` and a forced
 *     `tool_choice`. The model's job is to fill in a schema, not to write free
 *     prose that some downstream parser has to guess at. A malformed or
 *     unexpected tool call is an error, not something to salvage.
 *   - External content is fenced and the system prompt is told it is data.
 *     Callers cannot forget this: passing `untrusted` is the only way to get
 *     third-party text into a prompt here.
 *
 * The wrapper never executes anything. It returns structured data; deciding
 * what to do with it — and whether a human must approve first — is the
 * caller's job (see src/core/autonomy.ts).
 */

let anthropic: Anthropic | null = null;

function client(): Anthropic {
  if (!anthropic) {
    const key = env().ANTHROPIC_API_KEY;
    if (!key) {
      throw new LlmUnavailableError(
        'ANTHROPIC_API_KEY is not configured; LLM features are disabled',
      );
    }
    anthropic = new Anthropic({ apiKey: key });
  }
  return anthropic;
}

export class LlmUnavailableError extends Error {}
export class LlmProtocolError extends Error {}

export function isLlmConfigured(): boolean {
  return Boolean(env().ANTHROPIC_API_KEY);
}

export type JsonSchema = {
  type: 'object';
  properties: Record<string, unknown>;
  required: string[];
  additionalProperties: false;
};

export type StructuredCall<T> = {
  /** Names the operation; also the forced tool name. */
  toolName: string;
  toolDescription: string;
  inputSchema: JsonSchema;
  /** Runtime validation of the model's tool input. */
  parse: z.ZodType<T>;
  system: string;
  /** Trusted, first-party context assembled by our own code. */
  instruction: string;
  /** Third-party text. Fenced and declared as data before it reaches the model. */
  untrusted?: { content: string; label: string };
  maxTokens?: number;
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
};

export type StructuredResult<T> = {
  data: T;
  usage: { inputTokens: number; outputTokens: number };
  model: string;
};

export async function callStructured<T>(
  call: StructuredCall<T>,
): Promise<StructuredResult<T>> {
  const model = env().ANTHROPIC_MODEL;

  let system = call.system;
  let userText = call.instruction;

  if (call.untrusted) {
    const fenced = fenceUntrusted(call.untrusted.content, call.untrusted.label);
    system = `${system}\n\n${untrustedContentDirective(fenced.nonce)}`;
    userText = `${call.instruction}\n\n${fenced.text}`;
  }

  const response = await client().messages.create({
    model,
    max_tokens: call.maxTokens ?? 4096,
    thinking: { type: 'adaptive' },
    output_config: { effort: call.effort ?? 'medium' },
    system,
    // A single tool, forced. The model has no other verb available, so even a
    // successful injection inside fenced content has nothing to call.
    tools: [
      {
        name: call.toolName,
        description: call.toolDescription,
        strict: true,
        input_schema: call.inputSchema,
      },
    ],
    tool_choice: { type: 'tool', name: call.toolName },
    messages: [{ role: 'user', content: userText }],
  });

  if (response.stop_reason === 'refusal') {
    throw new LlmProtocolError(
      `model declined the request (${response.stop_details?.category ?? 'unspecified'})`,
    );
  }

  const block = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
  );
  if (!block) {
    throw new LlmProtocolError(
      `expected a ${call.toolName} tool call, got stop_reason=${response.stop_reason}`,
    );
  }
  if (block.name !== call.toolName) {
    throw new LlmProtocolError(
      `model called "${block.name}" but only "${call.toolName}" was offered`,
    );
  }

  const parsed = call.parse.safeParse(block.input);
  if (!parsed.success) {
    throw new LlmProtocolError(
      `tool input failed validation: ${parsed.error.issues
        .map((i) => `${i.path.join('.')} ${i.message}`)
        .join('; ')}`,
    );
  }

  return {
    data: parsed.data,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    },
    model: response.model,
  };
}

/** Rough spend estimate for the per-agent budget caps (§3.5). */
export function estimateCostUsd(usage: {
  inputTokens: number;
  outputTokens: number;
}): number {
  const INPUT_PER_MTOK = 5;
  const OUTPUT_PER_MTOK = 25;
  return (
    (usage.inputTokens / 1_000_000) * INPUT_PER_MTOK +
    (usage.outputTokens / 1_000_000) * OUTPUT_PER_MTOK
  );
}
