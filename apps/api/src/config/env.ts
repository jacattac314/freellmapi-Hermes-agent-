import { z } from 'zod';
import dotenv from 'dotenv';
import path from 'path';

// Load .env from the repo root (two levels up from apps/api)
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });
// Also try apps/api local .env
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const envSchema = z.object({
  PORT: z.string().default('3001').transform(Number),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.string().default('file:./dev.db'),

  // Optional bearer token for /v1 endpoints
  FREE_LLM_API_KEY: z.string().optional(),

  // Provider keys — all optional; missing keys disable the provider
  OPENROUTER_API_KEY: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),
  MISTRAL_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  GITHUB_TOKEN: z.string().optional(),
  CLOUDFLARE_API_TOKEN: z.string().optional(),
  CLOUDFLARE_ACCOUNT_ID: z.string().optional(),

  // Router tunables
  PROVIDER_TIMEOUT_MS: z.string().default('30000').transform(Number),
  PROVIDER_COOLDOWN_MS: z.string().default('60000').transform(Number),
});

function parseEnv() {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error('Invalid environment variables:');
    console.error(result.error.flatten().fieldErrors);
    process.exit(1);
  }
  return result.data;
}

export const env = parseEnv();
export type Env = typeof env;
