import { OpenAICompatibleProvider } from './base';

/**
 * Together AI — $1 free credit on signup, generous free models.
 * Docs: https://docs.together.ai/reference/chat-completions
 */
export class TogetherProvider extends OpenAICompatibleProvider {
  readonly name = 'together';
  readonly baseUrl = 'https://api.together.xyz/v1';
  readonly apiKeyEnvVar = 'TOGETHER_API_KEY';
}
