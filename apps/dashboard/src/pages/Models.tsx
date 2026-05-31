import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Save, ChevronDown, ChevronUp, GripVertical } from 'lucide-react';
import { api } from '../lib/api';

type Chain = Array<{ provider: string; model: string }>;
type AliasConfig = Record<string, Chain>;

const KNOWN_PROVIDERS = ['openrouter', 'groq', 'mistral', 'gemini', 'github', 'cloudflare'];

export default function ModelsPage() {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editingConfig, setEditingConfig] = useState<AliasConfig | null>(null);
  const [saved, setSaved] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['models'],
    queryFn: () => api.models(),
    onSuccess: (d: AliasConfig) => {
      if (!editingConfig) setEditingConfig(JSON.parse(JSON.stringify(d)));
    },
  } as any);

  const save = useMutation({
    mutationFn: (config: AliasConfig) => api.updateModels(config),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['models'] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  if (isLoading || !editingConfig) return <div className="p-8 text-gray-400">Loading...</div>;

  const config = editingConfig;

  const addAlias = () => {
    const name = prompt('New alias name:');
    if (!name) return;
    setEditingConfig({ ...config, [name]: [] });
    setExpanded(name);
  };

  const deleteAlias = (alias: string) => {
    const next = { ...config };
    delete next[alias];
    setEditingConfig(next);
  };

  const addEntry = (alias: string) => {
    const next = { ...config };
    next[alias] = [...(next[alias] ?? []), { provider: 'groq', model: '' }];
    setEditingConfig(next);
  };

  const removeEntry = (alias: string, idx: number) => {
    const next = { ...config };
    next[alias] = next[alias].filter((_, i) => i !== idx);
    setEditingConfig(next);
  };

  const updateEntry = (alias: string, idx: number, field: 'provider' | 'model', value: string) => {
    const next = { ...config };
    next[alias] = next[alias].map((e, i) => (i === idx ? { ...e, [field]: value } : e));
    setEditingConfig(next);
  };

  return (
    <div className="p-8">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-100">Model Aliases</h1>
          <p className="text-gray-400 mt-1">
            Define fallback chains. The router tries providers in order until one succeeds.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={addAlias}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm text-gray-300 transition-colors"
          >
            <Plus className="w-4 h-4" /> Add Alias
          </button>
          <button
            onClick={() => save.mutate(config)}
            disabled={save.isPending}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              saved
                ? 'bg-green-600 text-white'
                : 'bg-blue-600 hover:bg-blue-700 text-white'
            }`}
          >
            <Save className="w-4 h-4" />
            {saved ? 'Saved!' : save.isPending ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>

      <div className="space-y-3">
        {Object.entries(config).map(([alias, chain]) => (
          <div key={alias} className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <button
              onClick={() => setExpanded(expanded === alias ? null : alias)}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-800/50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <span className="font-mono font-semibold text-blue-400">"{alias}"</span>
                <span className="text-sm text-gray-500">{chain.length} provider{chain.length !== 1 ? 's' : ''}</span>
                <div className="flex gap-1">
                  {chain.slice(0, 3).map((e, i) => (
                    <span key={i} className="text-xs px-1.5 py-0.5 bg-gray-800 text-gray-400 rounded">
                      {e.provider}
                    </span>
                  ))}
                  {chain.length > 3 && (
                    <span className="text-xs text-gray-500">+{chain.length - 3}</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={(e) => { e.stopPropagation(); deleteAlias(alias); }}
                  className="text-gray-600 hover:text-red-400 transition-colors p-1"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
                {expanded === alias ? (
                  <ChevronUp className="w-4 h-4 text-gray-500" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-gray-500" />
                )}
              </div>
            </button>

            {expanded === alias && (
              <div className="px-4 pb-4 border-t border-gray-800">
                <div className="mt-3 space-y-2">
                  {chain.map((entry, idx) => (
                    <div key={idx} className="flex items-center gap-2 p-2 bg-gray-800/50 rounded-lg">
                      <span className="text-xs text-gray-600 w-5 text-center">{idx + 1}</span>
                      <GripVertical className="w-3.5 h-3.5 text-gray-700" />
                      <select
                        value={entry.provider}
                        onChange={(e) => updateEntry(alias, idx, 'provider', e.target.value)}
                        className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-gray-300 focus:outline-none focus:border-blue-500"
                      >
                        {KNOWN_PROVIDERS.map((p) => (
                          <option key={p} value={p}>{p}</option>
                        ))}
                      </select>
                      <input
                        value={entry.model}
                        onChange={(e) => updateEntry(alias, idx, 'model', e.target.value)}
                        placeholder="model-name or path"
                        className="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-gray-300 focus:outline-none focus:border-blue-500 font-mono"
                      />
                      <button
                        onClick={() => removeEntry(alias, idx)}
                        className="text-gray-600 hover:text-red-400 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={() => addEntry(alias)}
                    className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors py-1"
                  >
                    <Plus className="w-3 h-3" /> Add provider
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
