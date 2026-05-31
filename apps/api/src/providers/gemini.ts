import { OpenAICompatibleProvider } from './base';
import type { ChatCompletionRequest } from '@freellmapi/shared';

/**
 * Google Gemini — OpenAI-compatible endpoint via generativelanguage.googleapis.com.
 * Free tier: 15 RPM / 1M TPD on gemini-2.0-flash.
 * Docs: https://ai.google.dev/gemini-api/docs/openai
 *
 * Quirk: uses ?key=<API_KEY> query param instead of Authorization header,
 * but also accepts Bearer auth — we use Bearer for simplicity.
 */
export class GeminiProvider extends OpenAICompatibleProvider {
  readonly name = 'gemini';
  readonly baseUrl = 'https://generativelanguage.googleapis.com/v1beta/openai';
  readonly apiKeyEnvVar = 'GEMINI_API_KEY';
  // Tool calling is supported on Gemini 1.5+ and 2.x
  readonly supportsToolCalling = true;

  buildRequest(req: ChatCompletionRequest, targetModel: string): object {
    const body = super.buildRequest(req, targetModel) as Record<string, unknown>;
    // Gemini doesn't support 'stop' as an array in some configurations; pass through anyway
    return body;
  }
}
