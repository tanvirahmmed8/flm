import { describe, it, expect } from 'vitest';
import { compactChatHistory } from '../../lib/history-compact.js';

describe('compactChatHistory', () => {
  it('keeps system instructions and the newest turn while dropping older history', () => {
    const result = compactChatHistory({
      messages: [
        { role: 'system', content: 'You are a coding assistant.' },
        { role: 'user', content: 'old '.repeat(8000) },
        { role: 'assistant', content: 'older answer '.repeat(4000) },
        { role: 'user', content: 'Please fix the bug in the latest file.' },
      ],
      maxContextWindow: 5000,
      maxOutputTokens: 1000,
    });

    expect(result.compressed).toBe(true);
    expect(result.omittedMessages).toBeGreaterThan(0);
    expect(result.messages[0]).toMatchObject({ role: 'system', content: 'You are a coding assistant.' });
    expect(result.messages[1]).toMatchObject({ role: 'system' });
    expect(result.messages.at(-1)).toMatchObject({ role: 'user', content: 'Please fix the bug in the latest file.' });
    expect(result.compressedTotalTokens).toBeLessThan(result.originalTotalTokens);
  });

  it('preserves assistant tool_calls together with their tool results when retained', () => {
    const result = compactChatHistory({
      messages: [
        { role: 'system', content: 'You are a coding assistant.' },
        { role: 'user', content: 'old '.repeat(9000) },
        {
          role: 'assistant',
          content: null,
          tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'Read', arguments: '{"path":"a.txt"}' } }],
        },
        { role: 'tool', tool_call_id: 'call_1', content: 'file contents' },
        { role: 'user', content: 'Use that result and continue.' },
      ],
      maxContextWindow: 3000,
      maxOutputTokens: 1000,
    });

    const retained = result.messages.filter((message) => message.role !== 'system');
    expect(result.compressed).toBe(true);
    expect(retained).toHaveLength(3);
    expect(retained[0]).toMatchObject({ role: 'assistant' });
    expect(retained[1]).toMatchObject({ role: 'tool', tool_call_id: 'call_1' });
    expect(retained[2]).toMatchObject({ role: 'user', content: 'Use that result and continue.' });
  });
});
