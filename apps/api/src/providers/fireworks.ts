import { OpenAICompatibleProvider } from './base';

/**
 * Fireworks AI — fast open-model inference, free tier available.
 * Docs: https://readme.fireworks.ai/reference/createchatcompletion
 */
export class FireworksProvider extends OpenAICompatibleProvider {
  readonly name = 'fireworks';
  readonly baseUrl = 'https://api.fireworks.ai/inference/v1';
  readonly apiKeyEnvVar = 'FIREWORKS_API_KEY';
}
