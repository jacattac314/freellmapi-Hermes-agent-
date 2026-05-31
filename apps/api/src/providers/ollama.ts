import { OpenAICompatibleProvider } from './base';

/**
 * Ollama — local model inference via ollama.ai.
 * Fully OpenAI-compatible. No API key needed for local instances.
 * Default base URL: http://localhost:11434 (override via dashboard).
 */
export class OllamaProvider extends OpenAICompatibleProvider {
  readonly name = 'ollama';
  // Default local Ollama URL — overridden per-key via dashboard base_url field
  readonly baseUrl = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434/v1';
  readonly apiKeyEnvVar = 'OLLAMA_API_KEY'; // not used; Ollama doesn't require auth
  readonly supportsToolCalling = true;

  authHeader(_apiKey: string): Record<string, string> {
    // Ollama doesn't require authorization
    return {};
  }
}
