// Runs a prompt-defined agent on Claude via the Anthropic SDK.
// Needs ANTHROPIC_API_KEY (or another credential the SDK can resolve).
import Anthropic from '@anthropic-ai/sdk';

// USD per million tokens [input, output]
export const PRICING = {
  'claude-opus-5-5': [4, 20],
  'claude-sonnet-5-5': [2, 10],
  'claude-haiku-4-5': [1, 5],
  'claude-fable-5-1': [10, 50],
};

let client;
const getClient = () => (client ??= new Anthropic());

export default {
  type: 'claude',
  label: 'Claude (Anthropic API)',
  description: 'A prompt-based agent powered by Claude. Requires ANTHROPIC_API_KEY on the server.',
  configFields: [
    { key: 'model', label: 'Model', type: 'select', options: Object.keys(PRICING), default: 'claude-opus-5-5' },
    { key: 'systemPrompt', label: 'System prompt / instructions', type: 'textarea', default: 'You are a helpful assistant.' },
    { key: 'effort', label: 'Effort', type: 'select', options: ['low', 'medium', 'high', 'xhigh', 'max'], default: 'medium' },
    { key: 'maxTokens', label: 'Max output tokens', type: 'number', default: 16000 },
  ],
  async run({ agent, input, log, signal }) {
    const { model = 'claude-opus-5-5', systemPrompt, effort = 'medium', maxTokens = 16000 } = agent.config || {};
    log('info', `Calling ${model} (effort: ${effort})`);

    const params = {
      model,
      max_tokens: Number(maxTokens) || 16000,
      system: systemPrompt || undefined,
      messages: [{ role: 'user', content: input || '(no input provided)' }],
    };
    if (model !== 'claude-haiku-4-5') params.output_config = { effort };
    // Server-side refusal fallback (Claude API only; not available for Haiku).
    if (model !== 'claude-haiku-4-5') {
      params.betas = ['server-side-fallback-2026-07-01'];
      params.fallbacks = 'default';
    }

    const response = await getClient().beta.messages.create(params, { signal });

    for (const block of response.content) {
      if (block.type === 'fallback') log('warn', `${block.from?.model} declined; ${block.to?.model} continued`);
    }
    if (response.stop_reason === 'refusal') {
      throw new Error(`Claude declined the request${response.stop_details?.category ? ` (${response.stop_details.category})` : ''}`);
    }
    if (response.stop_reason === 'max_tokens') log('warn', 'Output was truncated at max_tokens');

    const output = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    const tokensIn = response.usage?.input_tokens ?? 0;
    const tokensOut = response.usage?.output_tokens ?? 0;
    const [pin, pout] = PRICING[response.model] || PRICING[model] || [0, 0];
    log('info', `Done: ${tokensIn} in / ${tokensOut} out tokens`);
    return { output, tokensIn, tokensOut, costUsd: (tokensIn * pin + tokensOut * pout) / 1e6 };
  },
};
