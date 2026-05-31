import { OpenAICompatibleProvider } from './base';

/**
 * Groq — extremely fast inference via custom LPU hardware.
 * Free tier: generous daily token limits across several open models.
 * Docs: https://console.groq.com/docs/openai
 */
export class GroqProvider extends OpenAICompatibleProvider {
  readonly name = 'groq';
  readonly baseUrl = 'https://api.groq.com/openai/v1';
  readonly apiKeyEnvVar = 'GROQ_API_KEY';
}
