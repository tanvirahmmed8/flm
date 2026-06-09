import { contentHasImage, contentToString } from './content.js';

function estimateTextTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function estimateJsonTokens(value: unknown): number {
  if (value == null) return 0;
  try {
    return estimateTextTokens(JSON.stringify(value));
  } catch {
    return 0;
  }
}

function estimateMessageTokens(message: Record<string, unknown>): number {
  let total = 0;

  total += estimateTextTokens(String(message.role ?? ''));
  total += estimateTextTokens(String(message.name ?? ''));
  total += estimateTextTokens(String(message.tool_call_id ?? ''));

  const content = message.content;
  total += estimateTextTokens(contentToString(content));

  if (Array.isArray(content) && contentHasImage(content)) {
    const imageCount = content.filter(block => {
      const type = (block as { type?: string })?.type;
      return type === 'image_url' || type === 'image';
    }).length;
    total += imageCount * 1000;
  }

  total += estimateJsonTokens(message.tool_calls);
  return total;
}

export interface EstimateChatRequestTokensOptions {
  messages: Array<Record<string, unknown>>;
  maxOutputTokens?: number;
  tools?: unknown;
  toolChoice?: unknown;
  parallelToolCalls?: boolean | null;
  extraPayload?: unknown[];
}

// Heuristic request-size estimate for routing and token-budget prechecks.
// Agent workloads are often dominated by tool schemas and tool-call history, so
// counting plain message text alone materially underestimates the true prompt.
export function estimateChatRequestTokens(opts: EstimateChatRequestTokensOptions): {
  inputTokens: number;
  totalTokens: number;
} {
  let inputTokens = opts.messages.reduce((sum, message) => sum + estimateMessageTokens(message), 0);
  inputTokens += estimateJsonTokens(opts.tools);
  inputTokens += estimateJsonTokens(opts.toolChoice);

  if (opts.parallelToolCalls !== undefined && opts.parallelToolCalls !== null) {
    inputTokens += estimateTextTokens(String(opts.parallelToolCalls));
  }

  for (const payload of opts.extraPayload ?? []) {
    inputTokens += estimateJsonTokens(payload);
  }

  return {
    inputTokens,
    totalTokens: inputTokens + (opts.maxOutputTokens ?? 1000),
  };
}
