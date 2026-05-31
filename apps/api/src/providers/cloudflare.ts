import { OpenAICompatibleProvider } from './base';

/**
 * Cloudflare Workers AI — runs open models on Cloudflare's edge network.
 * Free tier: 10k neurons/day. Requires an Account ID in the URL.
 * Docs: https://developers.cloudflare.com/workers-ai/configuration/open-ai-compatibility/
 *
 * The base URL is dynamic (includes account ID), so we compute it on construction.
 */
export class CloudflareProvider extends OpenAICompatibleProvider {
  readonly name = 'cloudflare';
  readonly apiKeyEnvVar = 'CLOUDFLARE_API_TOKEN';
  // Cloudflare streaming is supported but limited — mark true; router will fall back if needed
  readonly supportsStreaming = true;
  readonly supportsToolCalling = false; // limited tool support as of 2024

  get baseUrl(): string {
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID ?? '';
    return `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1`;
  }
}
