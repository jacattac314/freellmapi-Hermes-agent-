import { OpenAICompatibleProvider } from './base';

/**
 * GitHub Models — free access to curated frontier models via GitHub PAT.
 * Uses Azure AI Inference backend; fully OpenAI-compatible.
 * Docs: https://docs.github.com/en/github-models
 *
 * Limitation: rate limits are tight (low RPM/TPM) on free accounts.
 */
export class GitHubModelsProvider extends OpenAICompatibleProvider {
  readonly name = 'github';
  readonly baseUrl = 'https://models.inference.ai.azure.com';
  readonly apiKeyEnvVar = 'GITHUB_TOKEN';
  // Tool calling supported on GPT-4o and some Llama models
  readonly supportsToolCalling = true;
}
