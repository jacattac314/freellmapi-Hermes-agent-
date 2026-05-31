import { v4 as uuidv4 } from 'uuid';
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
  ChatMessage,
} from '@freellmapi/shared';
import type { LLMProvider } from './types';

/**
 * Base class for providers that speak OpenAI-compatible JSON.
 * Subclasses only need to override name, baseUrl, apiKeyEnvVar,
 * and optionally authHeader/extraHeaders for non-standard auth.
 */
export abstract class OpenAICompatibleProvider implements LLMProvider {
  abstract readonly name: string;
  abstract readonly baseUrl: string;
  abstract readonly apiKeyEnvVar: string;
  readonly supportsStreaming: boolean = true;
  readonly supportsToolCalling: boolean = true;
  readonly extraHeaders?: Record<string, string>;

  authHeader(apiKey: string): Record<string, string> {
    return { Authorization: `Bearer ${apiKey}` };
  }

  buildRequest(req: ChatCompletionRequest, targetModel: string): object {
    const body: Record<string, unknown> = {
      model: targetModel,
      messages: req.messages,
    };
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.max_tokens !== undefined) body.max_tokens = req.max_tokens;
    if (req.top_p !== undefined) body.top_p = req.top_p;
    if (req.stream !== undefined) body.stream = req.stream;
    if (req.stop !== undefined) body.stop = req.stop;
    if (req.tools && req.tools.length > 0) {
      body.tools = req.tools;
      if (req.tool_choice !== undefined) body.tool_choice = req.tool_choice;
    }
    return body;
  }

  normalizeResponse(raw: unknown): ChatCompletionResponse {
    // Most OpenAI-compatible providers already return the right shape.
    // We re-assign the id to ensure uniqueness in our logs.
    const r = raw as Record<string, unknown>;
    return {
      id: (r.id as string) ?? `chatcmpl-${uuidv4()}`,
      object: 'chat.completion',
      created: (r.created as number) ?? Math.floor(Date.now() / 1000),
      model: (r.model as string) ?? 'unknown',
      choices: (r.choices as ChatCompletionResponse['choices']) ?? [],
      usage: r.usage as ChatCompletionResponse['usage'],
    };
  }

  normalizeStreamChunk(line: string): ChatCompletionChunk | null {
    if (!line.startsWith('data: ')) return null;
    const data = line.slice(6).trim();
    if (data === '[DONE]') return null;
    try {
      return JSON.parse(data) as ChatCompletionChunk;
    } catch {
      return null;
    }
  }
}
