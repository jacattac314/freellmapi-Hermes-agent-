import { OpenAICompatibleProvider } from './base';

/**
 * SambaNova Cloud — free fast inference on SN40L chips.
 * Free tier: generous TPM on open Llama models.
 * Docs: https://community.sambanova.ai/docs
 */
export class SambanovaProvider extends OpenAICompatibleProvider {
  readonly name = 'sambanova';
  readonly baseUrl = 'https://fast-api.snova.ai/v1';
  readonly apiKeyEnvVar = 'SAMBANOVA_API_KEY';
}
