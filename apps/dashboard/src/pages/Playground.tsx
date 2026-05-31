import { useState, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Send, Loader2, AlertCircle } from 'lucide-react';
import { api } from '../lib/api';

interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export default function PlaygroundPage() {
  const [systemPrompt, setSystemPrompt] = useState('You are a helpful assistant.');
  const [userInput, setUserInput] = useState('');
  const [selectedModel, setSelectedModel] = useState('fast');
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(1024);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastMeta, setLastMeta] = useState<{ provider?: string; model?: string; latency?: number } | null>(null);
  const responseRef = useRef<HTMLDivElement>(null);

  const { data: modelsConfig } = useQuery({
    queryKey: ['models'],
    queryFn: () => api.models(),
  });

  const modelOptions = modelsConfig ? Object.keys(modelsConfig) : ['fast', 'smart', 'code'];

  const sendMessage = async () => {
    if (!userInput.trim() || loading) return;
    setError(null);

    const newMessages: Message[] = [...messages, { role: 'user', content: userInput }];
    setMessages(newMessages);
    setUserInput('');
    setLoading(true);

    const start = Date.now();

    try {
      const res = await api.chat({
        model: selectedModel,
        messages: [
          ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
          ...newMessages,
        ],
        temperature,
        max_tokens: maxTokens,
      });

      const data = await res.json();
      const latency = Date.now() - start;

      if (!res.ok) {
        setError(data?.error?.message ?? `HTTP ${res.status}`);
        return;
      }

      const assistantContent = data.choices?.[0]?.message?.content ?? '';
      setMessages([...newMessages, { role: 'assistant', content: assistantContent }]);
      setLastMeta({ provider: data._provider, model: data.model, latency });

      setTimeout(() => {
        responseRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 50);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      sendMessage();
    }
  };

  return (
    <div className="h-full flex flex-col p-6 gap-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-100">Playground</h1>
        <p className="text-gray-400 mt-1">Test your model aliases and provider routing.</p>
      </div>

      <div className="flex gap-4 flex-1 min-h-0">
        {/* Config panel */}
        <div className="w-64 flex-shrink-0 space-y-4">
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">Model Alias</label>
              <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-300 focus:outline-none focus:border-blue-500"
              >
                {modelOptions.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">
                Temperature: <span className="text-gray-300">{temperature}</span>
              </label>
              <input
                type="range"
                min="0"
                max="2"
                step="0.1"
                value={temperature}
                onChange={(e) => setTemperature(Number(e.target.value))}
                className="w-full accent-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">Max Tokens</label>
              <input
                type="number"
                value={maxTokens}
                onChange={(e) => setMaxTokens(Number(e.target.value))}
                min="1"
                max="32000"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-300 focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">System Prompt</label>
              <textarea
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                rows={4}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-300 focus:outline-none focus:border-blue-500 resize-none"
              />
            </div>

            <button
              onClick={() => { setMessages([]); setError(null); setLastMeta(null); }}
              className="w-full py-1.5 text-xs text-gray-500 hover:text-gray-300 border border-gray-700 hover:border-gray-600 rounded-lg transition-colors"
            >
              Clear conversation
            </button>
          </div>

          {lastMeta && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 text-xs text-gray-500 space-y-1">
              {lastMeta.latency && <div>Latency: <span className="text-gray-400">{lastMeta.latency}ms</span></div>}
              {lastMeta.model && <div>Model: <span className="text-gray-400 font-mono">{lastMeta.model}</span></div>}
            </div>
          )}
        </div>

        {/* Chat panel */}
        <div className="flex-1 flex flex-col bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.length === 0 && (
              <div className="h-full flex items-center justify-center">
                <div className="text-center text-gray-600">
                  <p className="text-sm">Send a message to start</p>
                  <p className="text-xs mt-1">Ctrl+Enter to send</p>
                </div>
              </div>
            )}
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[85%] rounded-xl px-4 py-3 text-sm whitespace-pre-wrap ${
                    msg.role === 'user'
                      ? 'bg-blue-600/20 text-gray-100 border border-blue-600/30'
                      : 'bg-gray-800 text-gray-200 border border-gray-700'
                  }`}
                >
                  <div className="text-xs mb-1 opacity-50 capitalize">{msg.role}</div>
                  {msg.content}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-gray-800 border border-gray-700 rounded-xl px-4 py-3">
                  <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
                </div>
              </div>
            )}
            {error && (
              <div className="flex items-start gap-2 p-3 bg-red-950/30 border border-red-800/40 rounded-xl text-sm text-red-400">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}
            <div ref={responseRef} />
          </div>

          {/* Input */}
          <div className="p-3 border-t border-gray-800">
            <div className="flex gap-2">
              <textarea
                value={userInput}
                onChange={(e) => setUserInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type a message... (Ctrl+Enter to send)"
                rows={2}
                className="flex-1 bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-gray-300 focus:outline-none focus:border-blue-500 resize-none placeholder-gray-600"
              />
              <button
                onClick={sendMessage}
                disabled={loading || !userInput.trim()}
                className="self-end px-4 py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl transition-colors"
              >
                {loading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
