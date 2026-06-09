import { describe, it, expect } from 'vitest';
import { isRetryableError, isPaymentRequiredError, shouldSkipProviderOnRetry, shouldCooldownOnRetry, shouldProviderCooldownOnRetry, isContextWindowError, parseContextWindowLimit } from '../../routes/proxy.js';

describe('isRetryableError', () => {
  describe('413 Payload Too Large', () => {
    it('treats explicit "413" in the error message as retryable', () => {
      expect(isRetryableError(new Error('GitHub Models API error 413: Request body too large'))).toBe(true);
      expect(isRetryableError(new Error('Cloudflare API error 413: Payload Too Large'))).toBe(true);
    });

    it('treats common 413 phrasings (no status code) as retryable', () => {
      expect(isRetryableError(new Error('Payload Too Large'))).toBe(true);
      expect(isRetryableError(new Error('Request body too large for this model'))).toBe(true);
      expect(isRetryableError(new Error('Request entity too large'))).toBe(true);
      expect(isRetryableError(new Error('Content too large'))).toBe(true);
    });
  });

  describe('404 model removed / not found (the bug #66 fixes)', () => {
    it('treats explicit "404" in the error message as retryable', () => {
      expect(isRetryableError(new Error('OpenRouter API error 404: Provider returned error'))).toBe(true);
      expect(isRetryableError(new Error('Groq API error 404: model not found'))).toBe(true);
    });

    it('catches OpenRouter\'s "No endpoints found" phrasing for deprecated models', () => {
      expect(isRetryableError(new Error('No endpoints found for openrouter/minimax/minimax-m2.5:free'))).toBe(true);
    });

    it('catches bare "not found" phrasing (any provider, any case)', () => {
      expect(isRetryableError(new Error('Model not found'))).toBe(true);
      expect(isRetryableError(new Error('The requested model was not found'))).toBe(true);
    });
  });

  describe('provider tool-call generation 400s fail over (#168)', () => {
    // Groq (and every other openai-compat provider) throws its errors as
    // `${name} API error ${status}: ${msg}`, so a tool-call-generation failure
    // surfaces as "Groq API error 400: Failed to call a function...". That
    // matches the "api error 400" rule, so it's ALREADY retryable and fails
    // over to the next provider — #168 is covered by existing behavior.
    it('treats a Groq failed_generation 400 as retryable', () => {
      expect(isRetryableError(new Error(
        "Groq API error 400: Failed to call a function. Please adjust your prompt. See 'failed_generation' for more details.",
      ))).toBe(true);
    });

    it('treats any openai-compat "API error 400" as retryable (one provider rejects params another accepts)', () => {
      expect(isRetryableError(new Error('Cerebras API error 400: tool schema not supported'))).toBe(true);
    });

    it('but a bare validation "400 Bad Request" (our own schema) is still NOT retryable', () => {
      expect(isRetryableError(new Error('400 Bad Request'))).toBe(false);
    });
  });

  describe('402 Payment Required out-of-credits fails over (graceful degradation)', () => {
    it('treats a HuggingFace Router 402 as retryable (same model lives on other providers)', () => {
      expect(isRetryableError(new Error('HuggingFace Router API error 402: Payment required'))).toBe(true);
    });

    it('catches common out-of-credits phrasings', () => {
      expect(isRetryableError(new Error('Payment Required'))).toBe(true);
      expect(isRetryableError(new Error('You exceeded your current quota: insufficient_quota'))).toBe(true);
      expect(isRetryableError(new Error('Insufficient credit for this request'))).toBe(true);
      expect(isRetryableError(new Error('Insufficient balance'))).toBe(true);
    });

    it('isPaymentRequiredError flags 402 (drives the long bench) but not a 429', () => {
      expect(isPaymentRequiredError(new Error('HuggingFace Router API error 402: Payment required'))).toBe(true);
      expect(isPaymentRequiredError(new Error('429 Too Many Requests'))).toBe(false);
      expect(isPaymentRequiredError(new Error('503 Service Unavailable'))).toBe(false);
    });

    it('skips the whole provider account for 402 on retry', () => {
      expect(shouldSkipProviderOnRetry(new Error('HuggingFace Router API error 402: Payment required'))).toBe(true);
    });
  });

  describe('existing categories still classify correctly', () => {
    it('429 / rate limits are retryable', () => {
      expect(isRetryableError(new Error('429 Too Many Requests'))).toBe(true);
      expect(isRetryableError(new Error('rate limit exceeded'))).toBe(true);
      expect(isRetryableError(new Error('quota exhausted'))).toBe(true);
      expect(shouldSkipProviderOnRetry(new Error('429 Too Many Requests'))).toBe(true);
    });

    it('5xx and network errors are retryable', () => {
      expect(isRetryableError(new Error('503 Service Unavailable'))).toBe(true);
      expect(isRetryableError(new Error('500 Internal Server Error'))).toBe(true);
      expect(isRetryableError(new Error('ETIMEDOUT'))).toBe(true);
      expect(isRetryableError(new Error('ECONNREFUSED'))).toBe(true);
      expect(shouldSkipProviderOnRetry(new Error('This operation was aborted'))).toBe(true);
    });

    it('4xx auth/validation errors are NOT retryable', () => {
      expect(isRetryableError(new Error('401 Unauthorized'))).toBe(false);
      expect(isRetryableError(new Error('403 Forbidden'))).toBe(false);
      expect(isRetryableError(new Error('400 Bad Request'))).toBe(false);
      expect(isRetryableError(new Error('Invalid API key'))).toBe(false);
    });

    it('keeps model-specific retry classes local to that model', () => {
      expect(shouldSkipProviderOnRetry(new Error('OpenRouter API error 404: model not found'))).toBe(false);
      expect(shouldSkipProviderOnRetry(new Error('503 Service Unavailable'))).toBe(false);
      expect(shouldSkipProviderOnRetry(new Error('empty completion from Model X'))).toBe(false);
    });

    it('skips the whole GitHub provider on body-size 413s', () => {
      expect(shouldSkipProviderOnRetry(new Error('GitHub Models API error 413: Request body too large'), 'github')).toBe(true);
      expect(shouldSkipProviderOnRetry(new Error('GitHub Models API error 413: Request body too large'))).toBe(false);
    });

    it('does not cooldown request-specific 400/413 failures across requests', () => {
      expect(shouldCooldownOnRetry(new Error('Google API error 400: Invalid JSON payload received. Unknown name \"uniqueItems\"'))).toBe(false);
      expect(shouldCooldownOnRetry(new Error('GitHub Models API error 413: Request body too large'), 'github')).toBe(false);
    });

    it('still cooldowns transient provider-state failures', () => {
      expect(shouldCooldownOnRetry(new Error('429 Too Many Requests'))).toBe(true);
      expect(shouldCooldownOnRetry(new Error('503 Service Unavailable'))).toBe(true);
      expect(shouldCooldownOnRetry(new Error('This operation was aborted'))).toBe(true);
    });

    it('adds provider-wide cooldown only for provider-scoped transient failures', () => {
      expect(shouldProviderCooldownOnRetry(new Error('429 Too Many Requests'))).toBe(true);
      expect(shouldProviderCooldownOnRetry(new Error('Google API error 400: Invalid JSON payload received'))).toBe(false);
      expect(shouldProviderCooldownOnRetry(new Error('GitHub Models API error 413: Request body too large'), 'github')).toBe(false);
      expect(shouldProviderCooldownOnRetry(new Error('503 Service Unavailable'))).toBe(false);
    });

    it('detects provider-reported context limit errors and extracts the learned ceiling', () => {
      const err = new Error('OpenRouter API error 400: This endpoint\'s maximum context length is 65536 tokens.');
      expect(isContextWindowError(err)).toBe(true);
      expect(parseContextWindowLimit(err)).toBe(65536);
    });

    it('detects alternate context-limit phrasing used by OpenAI-compatible gateways', () => {
      const err = new Error('Provider API error 400: Input token limit exceeded. This endpoint context limit is 128000 tokens.');
      expect(isContextWindowError(err)).toBe(true);
      expect(parseContextWindowLimit(err)).toBe(128000);
    });
  });
});
