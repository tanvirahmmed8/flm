import { describe, it, expect } from 'vitest';
import { estimateChatRequestTokens } from '../../lib/request-estimate.js';

describe('estimateChatRequestTokens', () => {
  it('counts message text and reserved output tokens', () => {
    const estimate = estimateChatRequestTokens({
      messages: [{ role: 'user', content: 'hello world' }],
      maxOutputTokens: 200,
    });

    expect(estimate.inputTokens).toBeGreaterThanOrEqual(3);
    expect(estimate.totalTokens).toBe(estimate.inputTokens + 200);
  });

  it('includes tool definitions in the estimate for agent workloads', () => {
    const messages = [{ role: 'user', content: 'review this repository' }];
    const tools = [{
      type: 'function',
      function: {
        name: 'read_file',
        description: 'Read a file from the workspace',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Absolute path to inspect' },
            reason: { type: 'string', description: 'Why the agent wants this file' },
            output_mode: { type: 'string', enum: ['summary', 'full'] },
          },
          required: ['path', 'reason'],
        },
      },
    }];

    const withoutTools = estimateChatRequestTokens({ messages, maxOutputTokens: 1000 });
    const withTools = estimateChatRequestTokens({ messages, maxOutputTokens: 1000, tools });

    expect(withTools.inputTokens).toBeGreaterThan(withoutTools.inputTokens);
    expect(withTools.totalTokens).toBeGreaterThan(withoutTools.totalTokens);
  });

  it('counts serialized tool-call history, not only visible assistant text', () => {
    const estimate = estimateChatRequestTokens({
      messages: [{
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: 'call_1',
          type: 'function',
          function: {
            name: 'search_workspace',
            arguments: JSON.stringify({ query: 'routing code', includeHidden: true }),
          },
        }],
      }],
      maxOutputTokens: 256,
    });

    expect(estimate.inputTokens).toBeGreaterThan(10);
  });
});
