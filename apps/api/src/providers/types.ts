import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
} from '@freellmapi/shared';

// What the router passes to a provider
export interface ProviderRequest {
  request: ChatCompletionRequest;
  targetModel: string; // resolved provider-native model name
}

// Core provider abstraction — every provider implements this
export interface LLMProvider {
  readonly name: string;
  readonly baseUrl: string;
  readonly supportsStreaming: boolean;
  readonly supportsToolCalling: boolean;

  /** Returns the Authorization header (and any extra required headers) */
  authHeader(apiKey: string): Record<string, string>;

  /** Transforms an OpenAI-style request into what the provider expects */
  buildRequest(req: ChatCompletionRequest, targetModel: string): object;

  /** Transforms provider response into OpenAI-compatible shape */
  normalizeResponse(raw: unknown): ChatCompletionResponse;

  /** Parse a single SSE data line into a streaming chunk (optional) */
  normalizeStreamChunk?(line: string): ChatCompletionChunk | null;

  /** The env var name that holds this provider's API key */
  apiKeyEnvVar: string;

  /** Extra headers always sent (e.g. OpenRouter referer) */
  extraHeaders?: Record<string, string>;
}

// Errors the router understands
export type ProviderFailureKind = 'rate_limited' | 'server_error' | 'timeout' | 'invalid_response' | 'auth_error' | 'unknown';

export class ProviderError extends Error {
  constructor(
    public readonly kind: ProviderFailureKind,
    public readonly providerName: string,
    public readonly statusCode: number | undefined,
    message: string,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
