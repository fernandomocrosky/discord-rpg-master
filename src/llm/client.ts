// Thin wrapper over the Anthropic Messages API. Knows nothing about Discord or campaign state.
import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.ts';

const client = new Anthropic({ apiKey: config.anthropicApiKey });

// Narration does not need deep reasoning; low effort keeps latency and (thinking) output tokens down.
const EFFORT = 'low';

// Thinking tokens count against max_tokens, so this is a safety ceiling, not the narration length.
// Narration length is controlled by the system prompt.
const DEFAULT_MAX_TOKENS = 4000;

export interface GenerateInput {
  system: string;
  messages: Anthropic.MessageParam[];
  maxTokens?: number;
}

export interface GenerateResult {
  text: string;
  usage: { inputTokens: number; outputTokens: number };
}

export async function generate({ system, messages, maxTokens = DEFAULT_MAX_TOKENS }: GenerateInput): Promise<GenerateResult> {
  const response = await client.messages.create({
    model: config.llmModel,
    max_tokens: maxTokens,
    system,
    messages,
    output_config: { effort: EFFORT },
  });

  if (response.stop_reason === 'refusal') {
    throw new Error('The model refused to answer.');
  }

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim();

  return {
    text,
    usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
  };
}
