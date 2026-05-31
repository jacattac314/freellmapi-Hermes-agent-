import { OpenAICompatibleProvider } from './base';

/**
 * Cohere — OpenAI-compatible endpoint at api.cohere.ai/compatibility/v1.
 * Free tier: ~33 RPD on Command-R models.
 * Docs: https://docs.cohere.com/reference/chat
 */
export class CohereProvider extends OpenAICompatibleProvider {
  readonly name = 'cohere';
  readonly baseUrl = 'https://api.cohere.ai/compatibility/v1';
  readonly apiKeyEnvVar = 'COHERE_API_KEY';
}
