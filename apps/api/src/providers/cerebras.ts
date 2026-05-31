import { OpenAICompatibleProvider } from './base';

/**
 * Cerebras — very fast inference on Wafer-Scale Engine hardware.
 * Free tier: 1M TPD, 60 RPM on llama-3.1-8b.
 * Docs: https://inference-docs.cerebras.ai/api-reference/chat-completions
 */
export class CerebrasProvider extends OpenAICompatibleProvider {
  readonly name = 'cerebras';
  readonly baseUrl = 'https://api.cerebras.ai/v1';
  readonly apiKeyEnvVar = 'CEREBRAS_API_KEY';
}
