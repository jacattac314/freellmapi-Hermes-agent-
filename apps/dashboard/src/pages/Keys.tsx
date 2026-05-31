import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, CheckCircle, XCircle, AlertCircle, RefreshCw, Eye, EyeOff, Lock } from 'lucide-react';
import { api } from '../lib/api';

const PROVIDERS = [
  'groq', 'cerebras', 'sambanova', 'openrouter', 'mistral', 'gemini',
  'nvidia', 'together', 'fireworks', 'github', 'cohere', 'huggingface',
  'cloudflare', 'ollama',
];

const STATUS_COLORS: Record<string, string> = {
  active: 'text-green-400',
  invalid: 'text-red-400',
  exhausted: 'text-yellow-400',
};

export default function KeysPage() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ platform: 'groq', apiKey: '', label: '', baseUrl: '' });
  const [showKey, setShowKey] = useState(false);
  const [validating, setValidating] = useState<number | null>(null);

  const { data: keys, isLoading, error } = useQuery({
    queryKey: ['keys'],
    queryFn: () => api.listKeys(),
    retry: false,
  });

  const addKey = useMutation({
    mutationFn: () => api.addKey({ platform: form.platform, apiKey: form.apiKey, label: form.label, baseUrl: form.baseUrl }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['keys'] });
      qc.invalidateQueries({ queryKey: ['providers'] });
      setShowForm(false);
      setForm({ platform: 'groq', apiKey: '', label: '', baseUrl: '' });
    },
  });

  const toggleKey = useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) => api.updateKey(id, { enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['keys'] }),
  });

  const deleteKey = useMutation({
    mutationFn: (id: number) => api.deleteKey(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['keys'] });
      qc.invalidateQueries({ queryKey: ['providers'] });
    },
  });

  const validate = async (id: number) => {
    setValidating(id);
    try {
      await api.validateKey(id);
      qc.invalidateQueries({ queryKey: ['keys'] });
    } finally {
      setValidating(null);
    }
  };

  const encryptionMissing = error && String(error).includes('503');

  return (
    <div className="p-8">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-100">API Keys</h1>
          <p className="text-gray-400 mt-1">
            Encrypted provider keys stored in SQLite (AES-256-GCM). Requires <code className="text-gray-300">ENCRYPTION_KEY</code> in your .env.
          </p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm text-white font-medium transition-colors"
        >
          <Plus className="w-4 h-4" /> Add Key
        </button>
      </div>

      {encryptionMissing && (
        <div className="mb-6 p-4 bg-yellow-950/30 border border-yellow-700/40 rounded-xl flex items-start gap-3">
          <Lock className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="text-yellow-300 font-medium">Encryption key not set</p>
            <p className="text-yellow-600 mt-1">
              Add <code className="text-yellow-400">ENCRYPTION_KEY</code> to your <code className="text-yellow-400">.env</code> file to enable secure key storage.
            </p>
            <p className="text-yellow-700 mt-1 font-mono text-xs">
              Generate: <span className="text-yellow-500">openssl rand -hex 32</span>
            </p>
          </div>
        </div>
      )}

      {/* Add key form */}
      {showForm && (
        <div className="mb-6 p-5 bg-gray-900 border border-gray-700 rounded-xl space-y-4">
          <h3 className="text-sm font-semibold text-gray-300">Add New Key</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">Provider</label>
              <select
                value={form.platform}
                onChange={(e) => setForm({ ...form, platform: e.target.value })}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-300 focus:outline-none focus:border-blue-500"
              >
                {PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">Label (optional)</label>
              <input
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
                placeholder="e.g. personal, team-1"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-300 focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">API Key</label>
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={form.apiKey}
                onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                placeholder="sk-..."
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 pr-10 text-sm text-gray-300 focus:outline-none focus:border-blue-500 font-mono"
              />
              <button
                onClick={() => setShowKey(!showKey)}
                className="absolute right-3 top-2 text-gray-500 hover:text-gray-300"
              >
                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          {(form.platform === 'ollama' || form.platform === 'cloudflare') && (
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">Custom Base URL (optional)</label>
              <input
                value={form.baseUrl}
                onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
                placeholder="http://localhost:11434/v1"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-300 focus:outline-none focus:border-blue-500 font-mono"
              />
            </div>
          )}
          <div className="flex gap-2">
            <button
              onClick={() => addKey.mutate()}
              disabled={!form.apiKey || addKey.isPending}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 rounded-lg text-sm text-white font-medium transition-colors"
            >
              {addKey.isPending ? 'Saving...' : 'Save Key'}
            </button>
            <button
              onClick={() => setShowForm(false)}
              className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm text-gray-300 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {isLoading && <div className="text-gray-500 text-sm">Loading keys...</div>}

      {/* Keys grouped by provider */}
      {!isLoading && !encryptionMissing && keys && keys.length === 0 && (
        <div className="text-center py-12 text-gray-600">
          <Lock className="w-8 h-8 mx-auto mb-3 opacity-40" />
          <p>No keys stored yet. Add one above or set env vars in .env.</p>
        </div>
      )}

      {keys && keys.length > 0 && (
        <div className="space-y-2">
          {keys.map((key: any) => (
            <div
              key={key.id}
              className={`flex items-center gap-4 p-4 bg-gray-900 border rounded-xl ${
                key.enabled ? 'border-gray-800' : 'border-gray-800/50 opacity-60'
              }`}
            >
              <div className="flex-1 grid grid-cols-4 gap-4 min-w-0">
                <div>
                  <p className="text-xs text-gray-500">Provider</p>
                  <p className="text-sm font-medium text-gray-200 capitalize">{key.platform}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Label</p>
                  <p className="text-sm text-gray-400">{key.label || <span className="text-gray-600">—</span>}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Status</p>
                  <p className={`text-sm font-medium ${STATUS_COLORS[key.status] ?? 'text-gray-400'}`}>
                    {key.status}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Added</p>
                  <p className="text-sm text-gray-500">{new Date(key.createdAt).toLocaleDateString()}</p>
                </div>
              </div>

              <div className="flex items-center gap-2 flex-shrink-0">
                {/* Validate */}
                <button
                  onClick={() => validate(key.id)}
                  disabled={validating === key.id}
                  title="Test key"
                  className="p-1.5 text-gray-500 hover:text-blue-400 transition-colors"
                >
                  {validating === key.id ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <CheckCircle className="w-4 h-4" />
                  )}
                </button>

                {/* Toggle enabled */}
                <button
                  onClick={() => toggleKey.mutate({ id: key.id, enabled: !key.enabled })}
                  title={key.enabled ? 'Disable' : 'Enable'}
                  className={`p-1.5 transition-colors ${key.enabled ? 'text-green-400 hover:text-gray-400' : 'text-gray-600 hover:text-green-400'}`}
                >
                  {key.enabled ? <CheckCircle className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                </button>

                {/* Delete */}
                <button
                  onClick={() => deleteKey.mutate(key.id)}
                  title="Delete key"
                  className="p-1.5 text-gray-600 hover:text-red-400 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
