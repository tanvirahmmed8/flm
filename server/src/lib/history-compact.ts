import type { ChatMessage, ChatToolChoice, ChatToolDefinition } from '@freellmapi/shared/types.js';
import { estimateChatRequestTokens } from './request-estimate.js';

interface CompactChatHistoryOptions {
  messages: ChatMessage[];
  maxContextWindow: number;
  maxOutputTokens?: number;
  tools?: ChatToolDefinition[];
  toolChoice?: ChatToolChoice;
  parallelToolCalls?: boolean | null;
  extraPayload?: unknown[];
}

export interface CompactChatHistoryResult {
  messages: ChatMessage[];
  compressed: boolean;
  omittedMessages: number;
  omittedGroups: number;
  originalInputTokens: number;
  compressedInputTokens: number;
  originalTotalTokens: number;
  compressedTotalTokens: number;
}

function estimateMessages(
  messages: ChatMessage[],
  opts: Pick<CompactChatHistoryOptions, 'maxOutputTokens' | 'tools' | 'toolChoice' | 'parallelToolCalls'>,
): { inputTokens: number; totalTokens: number } {
  return estimateChatRequestTokens({
    messages: messages as Array<Record<string, unknown>>,
    maxOutputTokens: opts.maxOutputTokens,
    tools: opts.tools,
    toolChoice: opts.toolChoice,
    parallelToolCalls: opts.parallelToolCalls,
    extraPayload: opts.extraPayload,
  });
}

function buildHistoryGroups(messages: ChatMessage[]): ChatMessage[][] {
  const groups: ChatMessage[][] = [];

  for (const message of messages) {
    const hasToolCalls = (message.tool_calls?.length ?? 0) > 0;
    const lastGroup = groups[groups.length - 1];
    const lastMessage = lastGroup?.[lastGroup.length - 1];
    const lastHasToolCalls = (lastMessage?.tool_calls?.length ?? 0) > 0;

    if (message.role === 'tool') {
      if (lastGroup && (lastHasToolCalls || lastMessage?.role === 'tool')) {
        lastGroup.push(message);
      } else {
        groups.push([message]);
      }
      continue;
    }

    if (message.role === 'assistant' && hasToolCalls) {
      groups.push([message]);
      continue;
    }

    groups.push([message]);
  }

  return groups;
}

export function compactChatHistory(opts: CompactChatHistoryOptions): CompactChatHistoryResult {
  const originalEstimate = estimateMessages(opts.messages, opts);
  if (originalEstimate.totalTokens <= opts.maxContextWindow) {
    return {
      messages: opts.messages,
      compressed: false,
      omittedMessages: 0,
      omittedGroups: 0,
      originalInputTokens: originalEstimate.inputTokens,
      compressedInputTokens: originalEstimate.inputTokens,
      originalTotalTokens: originalEstimate.totalTokens,
      compressedTotalTokens: originalEstimate.totalTokens,
    };
  }

  const reservedOutputTokens = opts.maxOutputTokens ?? 1000;
  const targetInputTokens = opts.maxContextWindow - reservedOutputTokens;
  if (targetInputTokens <= 0) {
    return {
      messages: opts.messages,
      compressed: false,
      omittedMessages: 0,
      omittedGroups: 0,
      originalInputTokens: originalEstimate.inputTokens,
      compressedInputTokens: originalEstimate.inputTokens,
      originalTotalTokens: originalEstimate.totalTokens,
      compressedTotalTokens: originalEstimate.totalTokens,
    };
  }

  const systemMessages = opts.messages.filter((message) => message.role === 'system');
  const nonSystemMessages = opts.messages.filter((message) => message.role !== 'system');
  const groups = buildHistoryGroups(nonSystemMessages);
  if (groups.length <= 1) {
    return {
      messages: opts.messages,
      compressed: false,
      omittedMessages: 0,
      omittedGroups: 0,
      originalInputTokens: originalEstimate.inputTokens,
      compressedInputTokens: originalEstimate.inputTokens,
      originalTotalTokens: originalEstimate.totalTokens,
      compressedTotalTokens: originalEstimate.totalTokens,
    };
  }

  const selectedGroups: ChatMessage[][] = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    const candidateGroups = [groups[i], ...selectedGroups];
    const candidateMessages = [
      ...systemMessages,
      ...candidateGroups.flat(),
    ];
    const candidateEstimate = estimateMessages(candidateMessages, opts);
    if (candidateEstimate.inputTokens <= targetInputTokens || selectedGroups.length === 0) {
      selectedGroups.unshift(groups[i]);
      continue;
    }
    break;
  }

  const omittedGroups = Math.max(0, groups.length - selectedGroups.length);
  if (omittedGroups === 0) {
    return {
      messages: opts.messages,
      compressed: false,
      omittedMessages: 0,
      omittedGroups: 0,
      originalInputTokens: originalEstimate.inputTokens,
      compressedInputTokens: originalEstimate.inputTokens,
      originalTotalTokens: originalEstimate.totalTokens,
      compressedTotalTokens: originalEstimate.totalTokens,
    };
  }

  const summaryMessage: ChatMessage = {
    role: 'system',
    content: `Earlier conversation history was omitted to fit the model context window. ${omittedGroups} earlier turn(s) were removed.`,
  };

  let compactedMessages = [
    ...systemMessages,
    summaryMessage,
    ...selectedGroups.flat(),
  ];
  let compactedEstimate = estimateMessages(compactedMessages, opts);

  while (selectedGroups.length > 1 && compactedEstimate.inputTokens > targetInputTokens) {
    selectedGroups.shift();
    compactedMessages = [
      ...systemMessages,
      summaryMessage,
      ...selectedGroups.flat(),
    ];
    compactedEstimate = estimateMessages(compactedMessages, opts);
  }

  const keptNonSystemMessages = selectedGroups.flat();
  const omittedMessages = Math.max(0, nonSystemMessages.length - keptNonSystemMessages.length);

  return {
    messages: compactedMessages,
    compressed: omittedMessages > 0,
    omittedMessages,
    omittedGroups,
    originalInputTokens: originalEstimate.inputTokens,
    compressedInputTokens: compactedEstimate.inputTokens,
    originalTotalTokens: originalEstimate.totalTokens,
    compressedTotalTokens: compactedEstimate.totalTokens,
  };
}
