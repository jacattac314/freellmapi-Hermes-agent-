import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock axios before importing router
vi.mock('axios', () => ({
  default: {
    post: vi.fn(),
  },
  AxiosError: class AxiosError extends Error {
    constructor(
      message: string,
      public code?: string,
      config?: any,
      request?: any,
      public response?: any,
    ) {
      super(message);
    }
  },
}));

// Mock DB so tests don't need SQLite
vi.mock('../src/db/usage', () => ({
  logRequest: vi.fn().mockResolvedValue(undefined),
}));

import axios from 'axios';
import { routeRequest, getCooldowns, resetCooldown } from '../src/router';

const mockAxios = axios as unknown as { post: ReturnType<typeof vi.fn> };

const MOCK_RESPONSE = {
  status: 200,
  data: {
    id: 'chatcmpl-test',
    object: 'chat.completion',
    created: 1700000000,
    model: 'llama-3.1-8b-instant',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: 'Hello from mock!' },
        finish_reason: 'stop',
      },
    ],
    usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
  },
};

describe('Provider fallback router', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear all cooldowns between tests
    for (const name of Array.from(getCooldowns().keys())) {
      resetCooldown(name);
    }
    // Provide a fake API key for groq so it gets tried
    process.env.GROQ_API_KEY = 'gsk_test_fake_key';
  });

  it('returns a successful response on first attempt', async () => {
    mockAxios.post.mockResolvedValueOnce(MOCK_RESPONSE);

    const result = await routeRequest({
      model: 'fast',
      messages: [{ role: 'user', content: 'hello' }],
    });

    expect(result.response.choices[0].message.content).toBe('Hello from mock!');
    expect(result.provider).toBe('groq');
  });

  it('falls back to next provider on 429', async () => {
    // First call returns 429 (rate limited)
    mockAxios.post.mockResolvedValueOnce({ status: 429, data: { error: 'rate limited' } });
    // Second call (openrouter) succeeds — need its key too
    process.env.OPENROUTER_API_KEY = 'or_test_fake_key';
    mockAxios.post.mockResolvedValueOnce(MOCK_RESPONSE);

    const result = await routeRequest({
      model: 'fast',
      messages: [{ role: 'user', content: 'hello' }],
    });

    expect(result.response.choices[0].message.content).toBe('Hello from mock!');
    expect(mockAxios.post).toHaveBeenCalledTimes(2);

    delete process.env.OPENROUTER_API_KEY;
  });

  it('throws when all providers fail', async () => {
    // groq returns 500
    mockAxios.post.mockResolvedValue({ status: 500, data: { error: 'server error' } });

    await expect(
      routeRequest({
        model: 'fast',
        messages: [{ role: 'user', content: 'hello' }],
      }),
    ).rejects.toThrow('All providers failed');
  });

  it('cooldown is set after rate-limit response', async () => {
    mockAxios.post.mockResolvedValue({ status: 429, data: {} });
    process.env.GROQ_API_KEY = 'gsk_test_fake_key';

    // Only groq available, it will get rate-limited
    try { await routeRequest({ model: 'fast', messages: [{ role: 'user', content: 'hi' }] }); }
    catch {}

    const cooldowns = getCooldowns();
    const groqCooldown = cooldowns.get('groq');
    expect(groqCooldown).toBeDefined();
    expect(groqCooldown!.getTime()).toBeGreaterThan(Date.now());
  });

  it('skips provider in cooldown', async () => {
    // Put groq in cooldown manually
    const future = new Date(Date.now() + 60000);
    getCooldowns().set('groq', future);

    // openrouter should be tried, succeed
    process.env.OPENROUTER_API_KEY = 'or_test_fake_key';
    mockAxios.post.mockResolvedValueOnce(MOCK_RESPONSE);

    const result = await routeRequest({
      model: 'fast',
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(result.provider).toBe('openrouter');
    delete process.env.OPENROUTER_API_KEY;
  });

  it('handles direct provider/model routing', async () => {
    mockAxios.post.mockResolvedValueOnce(MOCK_RESPONSE);

    const result = await routeRequest({
      model: 'groq/llama-3.1-8b-instant',
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(result.provider).toBe('groq');
    expect(result.model).toBe('llama-3.1-8b-instant');
  });
});
