# Free LLM API Router

A local OpenAI-compatible API gateway that routes requests across multiple free-tier LLM providers with automatic fallback, usage tracking, and a dashboard UI.

## Features

- **OpenAI-compatible** — works with any OpenAI SDK, LangChain, Cursor, etc.
- **Multi-provider routing** — Groq, OpenRouter, Mistral, Gemini, GitHub Models, Cloudflare Workers AI
- **Fallback chains** — automatically tries the next provider on 429, 5xx, or timeout
- **Model aliases** — map `"fast"`, `"smart"`, `"code"` to provider chains via config
- **Usage tracking** — SQLite logs for every request (latency, tokens, status)
- **Admin dashboard** — React UI for provider health, aliases, usage, and a playground
- **Streaming** — SSE streaming supported on all OpenAI-compatible providers
- **Optional API key** — protect `/v1` endpoints with `FREE_LLM_API_KEY`

## Quick Start

### 1. Clone and install

```bash
git clone <your-repo-url>
cd freellmapi-hermes-agent-
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and add at least one provider API key:

```env
GROQ_API_KEY=gsk_...          # groq.com — free, generous limits
OPENROUTER_API_KEY=sk-or-...  # openrouter.ai — free models with :free suffix
GEMINI_API_KEY=AIza...        # aistudio.google.com — free tier
MISTRAL_API_KEY=...           # console.mistral.ai
GITHUB_TOKEN=ghp_...          # github.com → Settings → Developer settings
CLOUDFLARE_API_TOKEN=...      # dash.cloudflare.com
CLOUDFLARE_ACCOUNT_ID=...
```

### 3. Initialize the database

```bash
npm run db:push
```

This creates `apps/api/dev.db` (SQLite) via Prisma.

### 4. Start the services

```bash
npm run dev
```

- **API server**: http://localhost:3001
- **Dashboard**: http://localhost:3000

---

## API Endpoints

### `GET /health`

Returns service status and active cooldowns.

```bash
curl http://localhost:3001/health
```

### `GET /v1/models`

Returns available model aliases and underlying provider models (OpenAI-compatible).

```bash
curl http://localhost:3001/v1/models
```

### `POST /v1/chat/completions`

OpenAI-compatible chat endpoint.

```bash
curl http://localhost:3001/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "fast",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

**With streaming:**
```bash
curl http://localhost:3001/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "fast",
    "messages": [{"role": "user", "content": "Count to 5"}],
    "stream": true
  }'
```

**Direct provider routing:**
```bash
# Route directly to a specific provider/model
curl http://localhost:3001/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "groq/llama-3.1-8b-instant",
    "messages": [{"role": "user", "content": "Hi!"}]
  }'
```

**With API key protection (if `FREE_LLM_API_KEY` is set):**
```bash
curl http://localhost:3001/v1/chat/completions \
  -H "Authorization: Bearer your-local-key" \
  -H "Content-Type: application/json" \
  -d '{"model": "smart", "messages": [{"role": "user", "content": "Write a haiku"}]}'
```

### Using with OpenAI SDK

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:3001/v1",
    api_key="your-local-key-or-any-string",  # required by SDK but optional here
)

response = client.chat.completions.create(
    model="fast",
    messages=[{"role": "user", "content": "Hello!"}],
)
print(response.choices[0].message.content)
```

```javascript
import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: 'http://localhost:3001/v1',
  apiKey: 'not-needed',
});

const response = await client.chat.completions.create({
  model: 'smart',
  messages: [{ role: 'user', content: 'What is 2+2?' }],
});
```

### Using with LangChain

```python
from langchain_openai import ChatOpenAI

llm = ChatOpenAI(
    openai_api_base="http://localhost:3001/v1",
    openai_api_key="not-needed",
    model_name="fast",
)
```

---

## Model Aliases

Defined in `apps/api/src/config/models.json`. Edit via the dashboard or directly:

| Alias    | Default Chain                            |
|----------|------------------------------------------|
| `fast`   | Groq llama-3.1-8b → OpenRouter llama → Gemini flash |
| `smart`  | OpenRouter deepseek-v3 → Mistral large → Groq 70b → Gemini |
| `code`   | OpenRouter qwen-2.5-coder → Groq qwq-32b → OpenRouter deepseek-r1 |
| `vision` | Gemini flash → OpenRouter gemini-1.5    |
| `free`   | All free-tier providers in sequence      |

You can also route directly: `"model": "groq/llama-3.1-8b-instant"`.

---

## Providers

| Provider     | Env Var                | Free Tier Notes                    |
|-------------|------------------------|------------------------------------|
| Groq         | `GROQ_API_KEY`         | Fast inference, generous daily limits |
| OpenRouter   | `OPENROUTER_API_KEY`   | Free models marked with `:free`    |
| Mistral      | `MISTRAL_API_KEY`      | Free experimental models           |
| Gemini       | `GEMINI_API_KEY`       | 15 RPM / 1M TPD on flash          |
| GitHub Models| `GITHUB_TOKEN`         | Low rate limits on free plan       |
| Cloudflare   | `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` | 10k neurons/day |

---

## Architecture

```
apps/api/src/
├── index.ts              # Express server entry point
├── config/
│   ├── env.ts            # Zod env validation
│   └── models.json       # Model alias → provider chain map
├── providers/
│   ├── types.ts          # LLMProvider interface + ProviderError
│   ├── base.ts           # OpenAICompatibleProvider base class
│   ├── openrouter.ts     # OpenRouter implementation
│   ├── groq.ts           # Groq implementation
│   ├── mistral.ts        # Mistral implementation
│   ├── gemini.ts         # Google Gemini implementation
│   ├── github-models.ts  # GitHub Models implementation
│   ├── cloudflare.ts     # Cloudflare Workers AI implementation
│   └── registry.ts       # Provider registry + key resolution
├── router/
│   └── index.ts          # Fallback routing + cooldown logic
├── routes/
│   ├── health.ts         # GET /health
│   ├── models.ts         # GET /v1/models
│   ├── chat.ts           # POST /v1/chat/completions
│   └── admin.ts          # /admin/* endpoints for dashboard
├── middleware/
│   ├── auth.ts           # Optional bearer token auth
│   └── error.ts          # Global error handler
└── db/
    ├── client.ts         # Prisma singleton
    └── usage.ts          # Request logging + stats queries
```

---

## Tests

```bash
npm run test
```

Tests cover:
- `/health` endpoint
- `/v1/models` response shape and auth
- Provider response normalization
- Fallback router behavior (429, 5xx, cooldown, skip)

---

## Known Limitations

1. **Streaming cooldown**: If a streaming request fails mid-stream, the client may receive partial data before an error.
2. **Cloudflare tool calling**: Not supported (Workers AI has limited function calling).
3. **GitHub Models rate limits**: Very tight (15 RPM) on free accounts — it's near the bottom of every chain by default.
4. **Model alias persistence**: Model aliases are stored in a JSON file; changes via the dashboard are written to disk but require a process restart to take effect in the router (hot-reload with `tsx watch` handles this automatically).
5. **No multi-key rotation**: Each provider supports one key. For production workloads, you'd want key rotation per provider.
6. **SQLite**: Fine for local use; swap to PostgreSQL via Prisma for multi-instance deployments.

---

## Next Recommended Improvements

1. **Per-key round-robin** — Accept multiple keys per provider and rotate on 429
2. **Request queue** — Throttle outbound requests to respect provider RPM limits
3. **Prompt caching** — Cache identical prompts for identical model/parameters
4. **Webhook notifications** — Alert when all providers for an alias are in cooldown
5. **HTTPS + reverse proxy** — Nginx/Caddy config for exposing over LAN
6. **Docker Compose** — Single-command start for API + dashboard
7. **Streaming token counting** — Parse SSE chunks to track tokens on streaming requests
