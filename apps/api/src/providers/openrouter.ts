import { OpenAICompatibleProvider } from './base';

/**
 * OpenRouter — proxies hundreds of models behind a single OpenAI-compatible API.
 * Free models are marked with `:free` suffix (e.g. "meta-llama/llama-3.1-8b-instruct:free").
 * Docs: https://openrouter.ai/docs
 */
export class OpenRouterProvider extends OpenAICompatibleProvider {
  readonly name = 'openrouter';
  readonly baseUrl = 'https://openrouter.ai/api/v1';
  readonly apiKeyEnvVar = 'OPENROUTER_API_KEY';

  // OpenRouter recommends these headers for attribution and rate-limit purposes
  readonly extraHeaders = {
    'HTTP-Referer': 'https://github.com/freellmapi',
    'X-Title': 'FreeLLMAPI Router',
  };
}
