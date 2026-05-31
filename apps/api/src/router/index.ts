import axios, { AxiosError } from 'axios';
import type { ChatCompletionRequest, ChatCompletionResponse } from '@freellmapi/shared';
import { env } from '../config/env';
import { getProviderByName, getApiKey, getEnabledProviders } from '../providers/registry';
import { ProviderError, type LLMProvider } from '../providers/types';
import { logRequest } from '../db/usage';
import modelAliases from '../config/models.json';
import type { ServerResponse } from 'http';

type ModelAliasMap = Record<string, Array<{ provider: string; model: string }>>;

// In-memory cooldown map: providerName → cooldown expiry time
const cooldowns = new Map<string, Date>();

export function getCooldowns(): Map<string, Date> {
  return cooldowns;
}

export function resetCooldown(providerName: string): void {
  cooldowns.delete(providerName);
}

function isInCooldown(providerName: string): boolean {
  const until = cooldowns.get(providerName);
  if (!until) return false;
  if (until <= new Date()) {
    cooldowns.delete(providerName);
    return false;
  }
  return true;
}

function setCooldown(providerName: string): void {
  const until = new Date(Date.now() + env.PROVIDER_COOLDOWN_MS);
  cooldowns.set(providerName, until);
  console.warn(`[router] Provider ${providerName} in cooldown until ${until.toISOString()}`);
}

/**
 * Classify an Axios error into a ProviderFailureKind so the router
 * knows whether to retry vs. bail out.
 */
function classifyError(
  err: unknown,
  providerName: string,
): ProviderError {
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

/** Resolve the fallback chain for a given requested model string */
function resolveChain(
  requestedModel: string,
): Array<{ provider: LLMProvider; model: string }> {
  const aliases = modelAliases as ModelAliasMap;

  // If it's a known alias, use its chain
  if (aliases[requestedModel]) {
    return aliases[requestedModel]
      .map(({ provider: pName, model }) => {
        const provider = getProviderByName(pName);
        return provider ? { provider, model } : null;
      })
      .filter((x): x is { provider: LLMProvider; model: string } => x !== null);
  }

  // Otherwise treat "provider/model" or "model" as a direct request.
  // Format: "groq/llama-3.1-8b-instant" → provider=groq, model=llama-3.1-8b-instant
  const slashIdx = requestedModel.indexOf('/');
  if (slashIdx > 0) {
    const pName = requestedModel.slice(0, slashIdx);
    const model = requestedModel.slice(slashIdx + 1);
    const provider = getProviderByName(pName);
    if (provider) return [{ provider, model }];
  }

  // Last resort: try all enabled providers with the literal model string
  return getEnabledProviders().map((p) => ({
    provider: p,
    model: requestedModel,
  }));
}

export interface RouteResult {
  response: ChatCompletionResponse;
  provider: string;
  model: string;
  latencyMs: number;
}

/**
 * Route a chat completion request through the provider fallback chain.
 * Skips providers in cooldown and records usage to SQLite.
 */
export async function routeRequest(
  req: ChatCompletionRequest,
  modelAlias?: string,
): Promise<RouteResult> {
  const chain = resolveChain(req.model);

  if (chain.length === 0) {
    throw new Error(`No providers configured for model "${req.model}". Check your .env file.`);
  }

  const errors: string[] = [];

  for (const { provider, model } of chain) {
    const apiKey = getApiKey(provider);
    if (!apiKey) {
      errors.push(`${provider.name}: no API key configured`);
      continue;
    }

    if (isInCooldown(provider.name)) {
      errors.push(`${provider.name}: in cooldown`);
      continue;
    }

    const start = Date.now();
    let status: 'success' | 'error' | 'timeout' | 'rate_limited' = 'error';
    let errorMessage: string | undefined;

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...provider.authHeader(apiKey),
        ...(provider.extraHeaders ?? {}),
      };

      const body = provider.buildRequest(req, model);

      const axiosResponse = await axios.post(
        `${provider.baseUrl}/chat/completions`,
        body,
        {
          headers,
          timeout: env.PROVIDER_TIMEOUT_MS,
          validateStatus: () => true, // we handle status ourselves
        },
      );

      const latencyMs = Date.now() - start;

      // Treat non-2xx as provider errors
      if (axiosResponse.status < 200 || axiosResponse.status >= 300) {
        const provErr = classifyError(
          new AxiosError(
            `HTTP ${axiosResponse.status}`,
            undefined,
            undefined,
            undefined,
            axiosResponse as any,
          ),
          provider.name,
        );

        if (provErr.kind === 'rate_limited' || provErr.kind === 'server_error' || provErr.kind === 'timeout') {
          setCooldown(provider.name);
        }

        status = provErr.kind === 'rate_limited' ? 'rate_limited' : provErr.kind === 'timeout' ? 'timeout' : 'error';
        errorMessage = provErr.message;
        errors.push(`${provider.name}/${model}: ${provErr.message}`);

        await logRequest({
          provider: provider.name,
          model,
          modelAlias: modelAlias ?? null,
          status,
          latencyMs,
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          errorMessage,
        });

        continue;
      }

      // Normalize the provider response to OpenAI shape
      const normalized = provider.normalizeResponse(axiosResponse.data);
      const usage = normalized.usage;
      status = 'success';

      await logRequest({
        provider: provider.name,
        model,
        modelAlias: modelAlias ?? null,
        status: 'success',
        latencyMs,
        promptTokens: usage?.prompt_tokens ?? 0,
        completionTokens: usage?.completion_tokens ?? 0,
        totalTokens: usage?.total_tokens ?? 0,
        errorMessage: null,
      });

      return { response: normalized, provider: provider.name, model, latencyMs };
    } catch (err) {
      const latencyMs = Date.now() - start;
      const provErr = classifyError(err, provider.name);

      if (provErr.kind === 'rate_limited' || provErr.kind === 'server_error' || provErr.kind === 'timeout') {
        setCooldown(provider.name);
      }

      status = provErr.kind === 'rate_limited' ? 'rate_limited' : provErr.kind === 'timeout' ? 'timeout' : 'error';
      errorMessage = provErr.message;
      errors.push(`${provider.name}/${model}: ${provErr.message}`);

      await logRequest({
        provider: provider.name,
        model,
        modelAlias: modelAlias ?? null,
        status,
        latencyMs,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        errorMessage,
      });
    }
  }

  throw new Error(
    `All providers failed for model "${req.model}":\n${errors.map((e) => `  - ${e}`).join('\n')}`,
  );
}

/**
 * Route a streaming request. Pipes SSE chunks from the first working
 * provider to the response stream. Falls back to non-streaming if streaming fails.
 */
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
    const apiKey = getApiKey(provider);
    if (!apiKey || isInCooldown(provider.name)) continue;
    if (!provider.supportsStreaming) continue;

    const start = Date.now();

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...provider.authHeader(apiKey),
        ...(provider.extraHeaders ?? {}),
      };

      const body = provider.buildRequest({ ...req, stream: true }, model);

      const axiosResponse = await axios.post(
        `${provider.baseUrl}/chat/completions`,
        body,
        {
          headers,
          timeout: env.PROVIDER_TIMEOUT_MS,
          responseType: 'stream',
          validateStatus: () => true,
        },
      );

      if (axiosResponse.status < 200 || axiosResponse.status >= 300) {
        setCooldown(provider.name);
        continue;
      }

      // Pipe the SSE stream through
      const stream = axiosResponse.data as NodeJS.ReadableStream;
      let buffer = '';

      stream.on('data', (chunk: Buffer) => {
        res.write(chunk);
      });

      stream.on('end', async () => {
        const latencyMs = Date.now() - start;
        res.write('data: [DONE]\n\n');
        res.end();
        await logRequest({
          provider: provider.name,
          model,
          modelAlias: modelAlias ?? null,
          status: 'success',
          latencyMs,
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          errorMessage: null,
        });
      });

      stream.on('error', () => {
        res.end();
      });

      return; // streaming started successfully
    } catch {
      setCooldown(provider.name);
    }
  }

  // All providers failed — return an error SSE event
  res.write(`data: ${JSON.stringify({ error: 'All providers failed or do not support streaming' })}\n\n`);
  res.end();
}
