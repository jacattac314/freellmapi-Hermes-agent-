import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('axios', () => ({
  default: { post: vi.fn() },
  AxiosError: class AxiosError extends Error {
    constructor(
      message: string,
      public code?: string,
      config?: any,
      request?: any,
      public response?: any,
    ) { super(message); }
  },
}));

vi.mock('../src/db/usage', () => ({
  logRequest: vi.fn().mockResolvedValue(undefined),
}));

// Mock the rate-limit DB calls so tests don't need a live DB connection
vi.mock('../src/services/ratelimit', async () => {
  const { clearAllCooldownsForTest, ...real } = await vi.importActual<any>('../src/services/ratelimit');
  const cooldowns = new Map<string, number>(); // platform:keyId → expiresAtMs

  return {
    ...real,
    clearAllCooldownsForTest: () => { cooldowns.clear(); },
    isOnCooldown: vi.fn(async (platform: string, keyId: number) => {
      const exp = cooldowns.get(`${platform}:${keyId}`);
      return exp !== undefined && exp > Date.now();
    }),
    setCooldown: vi.fn(async (platform: string, keyId: number) => {
      cooldowns.set(`${platform}:${keyId}`, Date.now() + 120_000);
    }),
    clearCooldown: vi.fn(async (platform: string, keyId: number) => {
      cooldowns.delete(`${platform}:${keyId}`);
    }),
    recordRequest: vi.fn(),
    _cooldowns: cooldowns, // expose for assertions
  };
});

import axios from 'axios';
import { routeRequest, getCooldowns, resetCooldown } from '../src/router';
import * as ratelimit from '../src/services/ratelimit';

const mockAxios = axios as unknown as { post: ReturnType<typeof vi.fn> };

const MOCK_RESPONSE = {
  status: 200,
  data: {
    id: 'chatcmpl-test',
    object: 'chat.completion',
    created: 1700000000,
    model: 'llama-3.1-8b-instant',
    choices: [{ index: 0, message: { role: 'assistant', content: 'Hello from mock!' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
  },
};

describe('Provider fallback router', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear per-key cooldowns
    (ratelimit as any).clearAllCooldownsForTest();
    // Clear provider-level cooldown map
    for (const name of Array.from(getCooldowns().keys())) resetCooldown(name);
    // Provide a fake env-var key for groq
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
    process.env.OPENROUTER_API_KEY = 'or_test_fake_key';
    // Groq returns 429, openrouter succeeds
    mockAxios.post.mockResolvedValueOnce({ status: 429, data: {} });
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
    mockAxios.post.mockResolvedValue({ status: 500, data: {} });

    await expect(
      routeRequest({ model: 'fast', messages: [{ role: 'user', content: 'hello' }] }),
    ).rejects.toThrow('All providers failed');
  });

  it('setCooldown is called after 429', async () => {
    mockAxios.post.mockResolvedValue({ status: 429, data: {} });

    try { await routeRequest({ model: 'fast', messages: [{ role: 'user', content: 'hi' }] }); } catch {}

    expect(ratelimit.setCooldown).toHaveBeenCalledWith('groq', -1);
  });

  it('skips provider key marked as on cooldown', async () => {
    // Put groq env-var key on cooldown
    await ratelimit.setCooldown('groq', -1);
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
