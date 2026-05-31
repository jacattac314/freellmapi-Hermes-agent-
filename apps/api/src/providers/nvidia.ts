import { OpenAICompatibleProvider } from './base';

/**
 * NVIDIA NIM — hosted inference of open models.
 * Free tier: 1000 API calls per model on ai.nvidia.com.
 * Docs: https://docs.api.nvidia.com/nim/reference/llm-apis
 */
export class NvidiaProvider extends OpenAICompatibleProvider {
  readonly name = 'nvidia';
  readonly baseUrl = 'https://integrate.api.nvidia.com/v1';
  readonly apiKeyEnvVar = 'NVIDIA_API_KEY';
}
