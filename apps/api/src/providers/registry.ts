import type { LLMProvider } from './types';
import { OpenRouterProvider } from './openrouter';
import { GroqProvider } from './groq';
import { MistralProvider } from './mistral';
import { GeminiProvider } from './gemini';
import { GitHubModelsProvider } from './github-models';
import { CloudflareProvider } from './cloudflare';
import { CerebrasProvider } from './cerebras';
import { SambanovaProvider } from './sambanova';
import { CohereProvider } from './cohere';
import { NvidiaProvider } from './nvidia';
import { TogetherProvider } from './together';
import { FireworksProvider } from './fireworks';
import { HuggingFaceProvider } from './huggingface';
import { OllamaProvider } from './ollama';
import { prisma } from '../db/client';
import { decrypt, encryptionAvailable } from '../lib/crypto';

// Singleton provider instances, ordered by default priority
const ALL_PROVIDERS: LLMProvider[] = [
  new GroqProvider(),
  new CerebrasProvider(),
  new SambanovaProvider(),
  new OpenRouterProvider(),
  new MistralProvider(),
  new GeminiProvider(),
  new NvidiaProvider(),
  new TogetherProvider(),
  new FireworksProvider(),
  new GitHubModelsProvider(),
  new CohereProvider(),
  new HuggingFaceProvider(),
  new CloudflareProvider(),
  new OllamaProvider(),
];

export interface ResolvedKey {
  keyId: number;       // DB row id, or -1 for env-var key
  apiKey: string;
  baseUrl?: string;   // per-key custom base URL (used by Ollama / custom providers)
}

/** Get the env-var fallback key for a provider (returns null if unset) */
function getEnvKey(provider: LLMProvider): string | null {
  return process.env[provider.apiKeyEnvVar] ?? null;
}

/**
 * Return all usable API keys for a provider.
 * DB-stored keys (decrypted) are listed first, then the env-var key if present.
 * Returns empty array when the provider has no configured keys.
 */
export async function getKeysForProvider(provider: LLMProvider): Promise<ResolvedKey[]> {
  const keys: ResolvedKey[] = [];

  // DB-stored encrypted keys (requires ENCRYPTION_KEY to be set)
  if (encryptionAvailable()) {
    try {
      const rows = await prisma.providerKey.findMany({
        where: { platform: provider.name, enabled: true, status: 'active' },
        orderBy: { id: 'asc' },
      });
      for (const row of rows) {
        try {
          const apiKey = decrypt({ encrypted: row.encryptedKey, iv: row.iv, authTag: row.authTag });
          keys.push({ keyId: row.id, apiKey, baseUrl: row.baseUrl ?? undefined });
        } catch {
          // Decryption failed (wrong ENCRYPTION_KEY or corrupt row) — skip silently
        }
      }
    } catch {
      // DB query failed — fall through to env-var
    }
  }

  // Env-var fallback key (keyId = -1 marks it as non-DB)
  const envKey = getEnvKey(provider);
  if (envKey) {
    keys.push({ keyId: -1, apiKey: envKey });
  }

  return keys;
}

/** Synchronous check: does this provider have at least one env-var key? */
export function getApiKey(provider: LLMProvider): string | undefined {
  return process.env[provider.apiKeyEnvVar] || undefined;
}

/** All providers with at least an env-var key configured */
export function getEnabledProviders(): LLMProvider[] {
  return ALL_PROVIDERS.filter((p) => !!getApiKey(p));
}

export function getProviderByName(name: string): LLMProvider | undefined {
  return ALL_PROVIDERS.find((p) => p.name === name);
}

export function getAllProviders(): LLMProvider[] {
  return ALL_PROVIDERS;
}

/**
 * Provider status summary for the admin dashboard.
 * Reports both env-var and DB key counts — never exposes actual key values.
 */
export async function getProviderStatuses(
  cooldowns: Map<string, Date>,
): Promise<object[]> {
  const statuses = await Promise.all(
    ALL_PROVIDERS.map(async (p) => {
      const hasEnvKey = !!getEnvKey(p);

      let dbKeyCount = 0;
      if (encryptionAvailable()) {
        try {
          dbKeyCount = await prisma.providerKey.count({
            where: { platform: p.name, enabled: true },
          });
        } catch {}
      }

      const inCooldown = cooldowns.has(p.name) && cooldowns.get(p.name)! > new Date();
      return {
        name: p.name,
        enabled: hasEnvKey || dbKeyCount > 0,
        hasEnvKey,
        dbKeyCount,
        encryptionAvailable: encryptionAvailable(),
        inCooldown,
        cooldownUntil: inCooldown ? cooldowns.get(p.name)!.toISOString() : null,
        supportsStreaming: p.supportsStreaming,
        supportsToolCalling: p.supportsToolCalling,
      };
    }),
  );
  return statuses;
}
