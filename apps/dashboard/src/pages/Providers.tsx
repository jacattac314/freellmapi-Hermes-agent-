import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle, XCircle, Clock, RefreshCw, AlertCircle } from 'lucide-react';
import { api } from '../lib/api';

interface ProviderStatus {
  name: string;
  enabled: boolean;
  hasApiKey: boolean;
  inCooldown: boolean;
  cooldownUntil: string | null;
  supportsStreaming: boolean;
  supportsToolCalling: boolean;
}

export default function ProvidersPage() {
  const qc = useQueryClient();

  const { data: providers, isLoading, error } = useQuery({
    queryKey: ['providers'],
    queryFn: () => api.providers(),
    refetchInterval: 10_000,
  });

  const { data: health } = useQuery({
    queryKey: ['health'],
    queryFn: () => api.health(),
    refetchInterval: 10_000,
  });

  const clearCooldown = useMutation({
    mutationFn: (name: string) => api.clearCooldown(name),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['providers'] });
      qc.invalidateQueries({ queryKey: ['health'] });
    },
  });

  if (isLoading) return <div className="p-8 text-gray-400">Loading providers...</div>;
  if (error) return <div className="p-8 text-red-400">Error: {String(error)}</div>;

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-100">Providers</h1>
        <p className="text-gray-400 mt-1">Configured LLM providers and their current status.</p>
      </div>

      {/* Health summary */}
      {health && (
        <div className="mb-6 p-4 bg-gray-900 rounded-xl border border-gray-800">
          <div className="flex items-center gap-2 text-sm">
            <CheckCircle className="w-4 h-4 text-green-400" />
            <span className="text-gray-300">
              <span className="font-medium text-green-400">{health.enabledProviders.length}</span> provider
              {health.enabledProviders.length !== 1 ? 's' : ''} active
              {health.activeCooldowns.length > 0 && (
                <span className="text-yellow-400 ml-3">
                  · {health.activeCooldowns.length} in cooldown
                </span>
              )}
            </span>
          </div>
        </div>
      )}

      {/* Provider grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {(providers as ProviderStatus[])?.map((p) => (
          <div
            key={p.name}
            className={`p-4 rounded-xl border ${
              p.inCooldown
                ? 'border-yellow-600/40 bg-yellow-950/20'
                : p.hasApiKey
                ? 'border-green-600/30 bg-gray-900'
                : 'border-gray-800 bg-gray-900/50'
            }`}
          >
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  {p.hasApiKey ? (
                    p.inCooldown ? (
                      <Clock className="w-4 h-4 text-yellow-400" />
                    ) : (
                      <CheckCircle className="w-4 h-4 text-green-400" />
                    )
                  ) : (
                    <XCircle className="w-4 h-4 text-gray-600" />
                  )}
                  <span className="font-semibold capitalize text-gray-100">{p.name}</span>
                </div>

                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Badge
                    label={p.hasApiKey ? 'Key set' : 'No key'}
                    color={p.hasApiKey ? 'green' : 'gray'}
                  />
                  {p.supportsStreaming && <Badge label="Streaming" color="blue" />}
                  {p.supportsToolCalling && <Badge label="Tools" color="purple" />}
                  {p.inCooldown && <Badge label="Cooldown" color="yellow" />}
                </div>

                {p.inCooldown && p.cooldownUntil && (
                  <p className="mt-2 text-xs text-yellow-500">
                    Until {new Date(p.cooldownUntil).toLocaleTimeString()}
                  </p>
                )}

                {!p.hasApiKey && (
                  <p className="mt-2 text-xs text-gray-500">
                    Set <code className="text-gray-400">{getEnvVar(p.name)}</code> in .env
                  </p>
                )}
              </div>

              {p.inCooldown && (
                <button
                  onClick={() => clearCooldown.mutate(p.name)}
                  className="text-yellow-400 hover:text-yellow-300 transition-colors"
                  title="Clear cooldown"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Badge({ label, color }: { label: string; color: 'green' | 'blue' | 'purple' | 'yellow' | 'gray' }) {
  const colors = {
    green: 'bg-green-900/40 text-green-400 border-green-700/30',
    blue: 'bg-blue-900/40 text-blue-400 border-blue-700/30',
    purple: 'bg-purple-900/40 text-purple-400 border-purple-700/30',
    yellow: 'bg-yellow-900/40 text-yellow-400 border-yellow-700/30',
    gray: 'bg-gray-800 text-gray-500 border-gray-700',
  };
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded border ${colors[color]}`}>
      {label}
    </span>
  );
}

function getEnvVar(name: string): string {
  const map: Record<string, string> = {
    openrouter: 'OPENROUTER_API_KEY',
    groq: 'GROQ_API_KEY',
    mistral: 'MISTRAL_API_KEY',
    gemini: 'GEMINI_API_KEY',
    github: 'GITHUB_TOKEN',
    cloudflare: 'CLOUDFLARE_API_TOKEN',
  };
  return map[name] ?? `${name.toUpperCase()}_API_KEY`;
}
