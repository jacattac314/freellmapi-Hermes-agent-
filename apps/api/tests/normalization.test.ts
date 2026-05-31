import { describe, it, expect } from 'vitest';
import { OpenRouterProvider } from '../src/providers/openrouter';
import { GroqProvider } from '../src/providers/groq';
import type { ChatCompletionRequest } from '@freellmapi/shared';

const openrouter = new OpenRouterProvider();
const groq = new GroqProvider();

const sampleResponse = {
  id: 'chatcmpl-abc123',
  object: 'chat.completion',
  created: 1700000000,
  model: 'llama-3.1-8b-instant',
  choices: [
    {
      index: 0,
      message: { role: 'assistant', content: 'Hello!' },
      finish_reason: 'stop',
    },
  ],
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
};

describe('Provider response normalization', () => {
  it('OpenRouter normalizes a standard response', () => {
    const result = openrouter.normalizeResponse(sampleResponse);
    expect(result.object).toBe('chat.completion');
    expect(result.choices[0].message.content).toBe('Hello!');
    expect(result.usage?.total_tokens).toBe(15);
  });

  it('Groq normalizes a standard response', () => {
    const result = groq.normalizeResponse(sampleResponse);
    expect(result.choices[0].finish_reason).toBe('stop');
  });

  it('normalizeResponse handles missing usage gracefully', () => {
    const noUsage = { ...sampleResponse, usage: undefined };
    const result = openrouter.normalizeResponse(noUsage);
    expect(result.usage).toBeUndefined();
  });

  it('buildRequest passes temperature and max_tokens', () => {
    const req: ChatCompletionRequest = {
      model: 'fast',
      messages: [{ role: 'user', content: 'hi' }],
      temperature: 0.7,
      max_tokens: 100,
    };
    const built = groq.buildRequest(req, 'llama-3.1-8b-instant') as any;
    expect(built.model).toBe('llama-3.1-8b-instant');
    expect(built.temperature).toBe(0.7);
    expect(built.max_tokens).toBe(100);
  });

  it('buildRequest omits tools when empty', () => {
    const req: ChatCompletionRequest = {
      model: 'fast',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [],
    };
    const built = groq.buildRequest(req, 'llama-3.1-8b-instant') as any;
    expect(built.tools).toBeUndefined();
  });

  it('OpenRouter includes extra headers', () => {
    expect(openrouter.extraHeaders?.['HTTP-Referer']).toBeTruthy();
    expect(openrouter.extraHeaders?.['X-Title']).toBeTruthy();
  });

  it('Groq auth header uses Bearer scheme', () => {
    const header = groq.authHeader('my-key');
    expect(header.Authorization).toBe('Bearer my-key');
  });
});
