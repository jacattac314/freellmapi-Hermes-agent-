import axios, { AxiosError } from 'axios';
import type { ChatCompletionRequest, ChatCompletionResponse } from '@freellmapi/shared';
import { env } from '../config/env';
import { getProviderByName, getEnabledProviders, getKeysForProvider } from '../providers/registry';
import { ProviderError, type LLMProvider } from '../providers/types';
import { logRequest } from '../db/usage';
import { setCooldown, isOnCooldown, clearCooldown, recordRequest } from '../services/ratelimit';
import modelAliases from '../config/models.json';
import type { ServerResponse } from 'http';

type ModelAliasMap = Record<string, Array<{ provider: string; model: string }>>;

// Provider-level cooldown map (legacy — kept for /admin/providers display)
// Per-key cooldowns live in the ratelimit service.
const providerCooldowns = new Map<string, Date>();

export function getCooldowns(): Map<string, Date> {
  return providerCooldowns;
}

export function resetCooldown(providerName: string): void {
  providerCooldowns.delete(providerName);
}

function classifyError(err: unknown, providerName: string): ProviderError {
  if (err instanceof AxiosError) {
    const status = err.response?.status;
    if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
      return new ProviderError('timeout', providerName, undefined, `Timeout calling ${providerName}`);
    }
    if (status === 429) {
      return new ProviderError('rate_limited', providerName, status, `Rate limited by ${providerName}`);
    }
    if (status === 401 || status === 403) {
      return new ProviderError('auth_error', providerName, status, `Auth error from ${providerName}: ${status}`);
    }
    if (status && status >= 500) {
      return new ProviderError('server_error', providerName, status, `Server error from ${providerName}: ${status}`);
    }
    return new ProviderError('unknown', providerName, status, `HTTP ${status} from ${providerName}`);
  }
  return new ProviderError('unknown', providerName, undefined, String(err));
}

function resolveChain(requestedModel: string): Array<{ provider: LLMProvider; model: string }> {
  const aliases = modelAliases as ModelAliasMap;

  if (aliases[requestedModel]) {
    return aliases[requestedModel]
      .map(({ provider: pName, model }) => {
        const provider = getProviderByName(pName);
        return provider ? { provider, model } : null;
      })
      .filter((x): x is { provider: LLMProvider; model: string } => x !== null);
  }

  const slashIdx = requestedModel.indexOf('/');
  if (slashIdx > 0) {
    const pName = requestedModel.slice(0, slashIdx);
    const model = requestedModel.slice(slashIdx + 1);
    const provider = getProviderByName(pName);
    if (provider) return [{ provider, model }];
  }

  return getEnabledProviders().map((p) => ({ provider: p, model: requestedModel }));
}

export interface RouteResult {
  response: ChatCompletionResponse;
  provider: string;
  model: string;
  latencyMs: number;
}

/**
 * Route a chat completion request through the provider fallback chain.
 *
 * For each provider in the chain:
 *   1. Fetch all enabled keys (DB-stored + env-var fallback).
 *   2. For each key, check per-key cooldown and rate limit windows.
 *   3. On 429 → escalating cooldown for that key; try next key.
 *   4. On 5xx/timeout → short provider-level cooldown; move to next provider.
 */
export async function routeRequest(
  req: ChatCompletionRequest,
  modelAlias?: string,
): Promise<RouteResult> {
  const chain = resolveChain(req.model);

  if (chain.length === 0) {
    throw new Error(`No providers configured for model "${req.model}". Check your .env file or add keys via the dashboard.`);
  }

  const errors: string[] = [];

  for (const { provider, model } of chain) {
    const keys = await getKeysForProvider(provider);
    if (keys.length === 0) {
      errors.push(`${provider.name}: no keys configured`);
      continue;
    }

    for (const { keyId, apiKey, baseUrl } of keys) {
      if (await isOnCooldown(provider.name, keyId)) {
        errors.push(`${provider.name}[key:${keyId}]: in cooldown`);
        continue;
      }

      const start = Date.now();

      try {
        const effectiveBaseUrl = baseUrl ?? provider.baseUrl;
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          ...provider.authHeader(apiKey),
          ...(provider.extraHeaders ?? {}),
        };

        const body = provider.buildRequest(req, model);

        const axiosResponse = await axios.post(
          `${effectiveBaseUrl}/chat/completions`,
          body,
          { headers, timeout: env.PROVIDER_TIMEOUT_MS, validateStatus: () => true },
        );

        const latencyMs = Date.now() - start;

        if (axiosResponse.status === 429) {
          await setCooldown(provider.name, keyId); // escalating duration
          const hint = `${provider.name}[key:${keyId}]: rate limited (cooldown applied)`;
          console.warn(`[router] ${hint}`);
          errors.push(hint);

          await logRequest({
            provider: provider.name, model, modelAlias: modelAlias ?? null, keyId,
            status: 'rate_limited', latencyMs, promptTokens: 0,
            completionTokens: 0, totalTokens: 0, errorMessage: 'Rate limited',
          });
          continue; // try next key
        }

        if (axiosResponse.status < 200 || axiosResponse.status >= 300) {
          const hint = `${provider.name}[key:${keyId}]: HTTP ${axiosResponse.status}`;
          errors.push(hint);

          // 5xx → short provider-level cooldown, skip remaining keys for this provider
          if (axiosResponse.status >= 500) {
            providerCooldowns.set(provider.name, new Date(Date.now() + 30_000));
            await setCooldown(provider.name, keyId, 30_000);
            await logRequest({
              provider: provider.name, model, modelAlias: modelAlias ?? null, keyId,
              status: 'error', latencyMs, promptTokens: 0,
              completionTokens: 0, totalTokens: 0,
              errorMessage: `HTTP ${axiosResponse.status}`,
            });
            break; // move to next provider
          }

          await logRequest({
            provider: provider.name, model, modelAlias: modelAlias ?? null, keyId,
            status: 'error', latencyMs, promptTokens: 0,
            completionTokens: 0, totalTokens: 0,
            errorMessage: `HTTP ${axiosResponse.status}`,
          });
          continue;
        }

        const normalized = provider.normalizeResponse(axiosResponse.data);
        const usage = normalized.usage;

        recordRequest(provider.name, keyId);

        await logRequest({
          provider: provider.name, model, modelAlias: modelAlias ?? null, keyId,
          status: 'success', latencyMs,
          promptTokens: usage?.prompt_tokens ?? 0,
          completionTokens: usage?.completion_tokens ?? 0,
          totalTokens: usage?.total_tokens ?? 0,
          errorMessage: null,
        });

        return { response: normalized, provider: provider.name, model, latencyMs };
      } catch (err) {
        const latencyMs = Date.now() - start;
        const provErr = classifyError(err, provider.name);

        if (provErr.kind === 'timeout' || provErr.kind === 'server_error') {
          providerCooldowns.set(provider.name, new Date(Date.now() + 30_000));
          await setCooldown(provider.name, keyId, 30_000);
          await logRequest({
            provider: provider.name, model, modelAlias: modelAlias ?? null, keyId,
            status: provErr.kind === 'timeout' ? 'timeout' : 'error',
            latencyMs, promptTokens: 0, completionTokens: 0, totalTokens: 0,
            errorMessage: provErr.message,
          });
          break; // move to next provider
        }

        if (provErr.kind === 'rate_limited') {
          await setCooldown(provider.name, keyId);
        }

        errors.push(`${provider.name}[key:${keyId}]: ${provErr.message}`);
        await logRequest({
          provider: provider.name, model, modelAlias: modelAlias ?? null, keyId,
          status: 'rate_limited', latencyMs, promptTokens: 0,
          completionTokens: 0, totalTokens: 0, errorMessage: provErr.message,
        });
      }
    }
  }

  throw new Error(
    `All providers failed for model "${req.model}":\n${errors.map((e) => `  - ${e}`).join('\n')}`,
  );
}

/** Route a streaming request — pipes SSE from the first working key/provider */
export async function routeStreamingRequest(
  req: ChatCompletionRequest,
  res: ServerResponse,
  modelAlias?: string,
): Promise<void> {
  const chain = resolveChain(req.model);

  if (chain.length === 0) {
    res.write(`data: ${JSON.stringify({ error: `No providers for model "${req.model}"` })}\n\n`);
    res.end();
    return;
  }

  for (const { provider, model } of chain) {
    if (!provider.supportsStreaming) continue;
    const keys = await getKeysForProvider(provider);

    for (const { keyId, apiKey, baseUrl } of keys) {
      if (await isOnCooldown(provider.name, keyId)) continue;

      const start = Date.now();
      const effectiveBaseUrl = baseUrl ?? provider.baseUrl;

      try {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          ...provider.authHeader(apiKey),
          ...(provider.extraHeaders ?? {}),
        };
        const body = provider.buildRequest({ ...req, stream: true }, model);

        const axiosResponse = await axios.post(
          `${effectiveBaseUrl}/chat/completions`,
          body,
          { headers, timeout: env.PROVIDER_TIMEOUT_MS, responseType: 'stream', validateStatus: () => true },
        );

        if (axiosResponse.status === 429) {
          await setCooldown(provider.name, keyId);
          continue;
        }
        if (axiosResponse.status < 200 || axiosResponse.status >= 300) {
          if (axiosResponse.status >= 500) break;
          continue;
        }

        recordRequest(provider.name, keyId);
        const stream = axiosResponse.data as NodeJS.ReadableStream;

        stream.on('data', (chunk: Buffer) => { res.write(chunk); });
        stream.on('end', async () => {
          res.write('data: [DONE]\n\n');
          res.end();
          await logRequest({
            provider: provider.name, model, modelAlias: modelAlias ?? null, keyId,
            status: 'success', latencyMs: Date.now() - start,
            promptTokens: 0, completionTokens: 0, totalTokens: 0, errorMessage: null,
          });
        });
        stream.on('error', () => { res.end(); });
        return;
      } catch {
        await setCooldown(provider.name, keyId, 30_000);
      }
    }
  }

  res.write(`data: ${JSON.stringify({ error: 'All providers failed or do not support streaming' })}\n\n`);
  res.end();
}
