import { env } from '../config/env';
import type { LLMProvider } from './types';
import { OpenRouterProvider } from './openrouter';
import { GroqProvider } from './groq';
import { MistralProvider } from './mistral';
import { GeminiProvider } from './gemini';
import { GitHubModelsProvider } from './github-models';
import { CloudflareProvider } from './cloudflare';

// All registered providers in default priority order
const ALL_PROVIDERS: LLMProvider[] = [
  new GroqProvider(),
  new OpenRouterProvider(),
  new MistralProvider(),
  new GeminiProvider(),
  new GitHubModelsProvider(),
  new CloudflareProvider(),
];

/** Returns the API key for a provider from the environment */
export function getApiKey(provider: LLMProvider): string | undefined {
  return process.env[provider.apiKeyEnvVar] || undefined;
}

/** Returns providers that have a configured API key */
export function getEnabledProviders(): LLMProvider[] {
  return ALL_PROVIDERS.filter((p) => !!getApiKey(p));
}

/** Look up a provider by name */
export function getProviderByName(name: string): LLMProvider | undefined {
  return ALL_PROVIDERS.find((p) => p.name === name);
}

/** All registered provider definitions (regardless of key presence) */
export function getAllProviders(): LLMProvider[] {
  return ALL_PROVIDERS;
}

/** Provider status for the admin API — never exposes actual keys */
export function getProviderStatuses(cooldowns: Map<string, Date>) {
  return ALL_PROVIDERS.map((p) => {
    const hasApiKey = !!getApiKey(p);
    const cooldownUntil = cooldowns.get(p.name);
    const inCooldown = cooldownUntil ? cooldownUntil > new Date() : false;
    return {
      name: p.name,
      enabled: hasApiKey,
      hasApiKey,
      inCooldown,
      cooldownUntil: inCooldown && cooldownUntil ? cooldownUntil.toISOString() : null,
      supportsStreaming: p.supportsStreaming,
      supportsToolCalling: p.supportsToolCalling,
    };
  });
}
