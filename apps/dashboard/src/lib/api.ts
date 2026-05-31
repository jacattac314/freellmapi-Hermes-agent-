// API client for the backend — uses relative paths (proxied in dev, same origin in prod)

const API_KEY = localStorage.getItem('freellmapi_key') ?? '';

function headers(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (API_KEY) h['Authorization'] = `Bearer ${API_KEY}`;
  return h;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: headers() });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json();
}

async function put<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'PUT',
    headers: headers(),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json();
}

async function del<T>(path: string): Promise<T> {
  const res = await fetch(path, { method: 'DELETE', headers: headers() });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json();
}

export const api = {
  health: () => get<{ status: string; enabledProviders: string[]; activeCooldowns: any[] }>('/health'),
  providers: () => get<any[]>('/admin/providers'),
  clearCooldown: (name: string) => del<{ ok: boolean }>(`/admin/cooldowns/${name}`),
  models: () => get<Record<string, Array<{ provider: string; model: string }>>>('/admin/models'),
  updateModels: (config: Record<string, Array<{ provider: string; model: string }>>) =>
    put<{ ok: boolean }>('/admin/models', config),
  usageStats: () => get<any>('/admin/usage'),
  recentLogs: (limit = 50) => get<any[]>(`/admin/usage/recent?limit=${limit}`),
  failedLogs: (limit = 20) => get<any[]>(`/admin/usage/failed?limit=${limit}`),
  chat: (body: object) =>
    fetch('/v1/chat/completions', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(body),
    }),
};
