import { OpenAICompatibleProvider } from './base';

/**
 * Mistral AI — OpenAI-compatible endpoint.
 * Free tier available at La Plateforme for experimental models.
 * Docs: https://docs.mistral.ai/api/
 */
export class MistralProvider extends OpenAICompatibleProvider {
  readonly name = 'mistral';
  readonly baseUrl = 'https://api.mistral.ai/v1';
  readonly apiKeyEnvVar = 'MISTRAL_API_KEY';
}
