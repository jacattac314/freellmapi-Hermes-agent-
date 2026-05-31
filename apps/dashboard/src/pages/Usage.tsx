import { useQuery } from '@tanstack/react-query';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { CheckCircle, XCircle, Clock, Zap } from 'lucide-react';
import { api } from '../lib/api';

const STATUS_COLORS: Record<string, string> = {
  success: '#4ade80',
  error: '#f87171',
  timeout: '#facc15',
  rate_limited: '#fb923c',
};

export default function UsagePage() {
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['usageStats'],
    queryFn: () => api.usageStats(),
    refetchInterval: 15_000,
  });

  const { data: recent, isLoading: recentLoading } = useQuery({
    queryKey: ['recentLogs'],
    queryFn: () => api.recentLogs(50),
    refetchInterval: 15_000,
  });

  const { data: failed } = useQuery({
    queryKey: ['failedLogs'],
    queryFn: () => api.failedLogs(10),
    refetchInterval: 15_000,
  });

  if (statsLoading) return <div className="p-8 text-gray-400">Loading stats...</div>;

  return (
    <div className="p-8 space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-100">Usage</h1>
        <p className="text-gray-400 mt-1">Request history, token usage, and provider performance.</p>
      </div>

      {/* Summary cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            label="Total Requests"
            value={stats.totalRequests.toLocaleString()}
            icon={<Zap className="w-5 h-5 text-blue-400" />}
          />
          <StatCard
            label="Success Rate"
            value={`${stats.successRate}%`}
            icon={<CheckCircle className="w-5 h-5 text-green-400" />}
          />
          <StatCard
            label="Avg Latency"
            value={`${stats.avgLatencyMs}ms`}
            icon={<Clock className="w-5 h-5 text-yellow-400" />}
          />
          <StatCard
            label="Total Tokens"
            value={stats.totalTokens.toLocaleString()}
            icon={<XCircle className="w-5 h-5 text-purple-400" />}
          />
        </div>
      )}

      {/* Per-provider chart */}
      {stats?.byProvider?.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-gray-300 mb-4">Requests by Provider</h2>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={stats.byProvider}>
              <XAxis dataKey="provider" tick={{ fill: '#9ca3af', fontSize: 12 }} />
              <YAxis tick={{ fill: '#9ca3af', fontSize: 12 }} />
              <Tooltip
                contentStyle={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 8 }}
                labelStyle={{ color: '#e5e7eb' }}
                itemStyle={{ color: '#9ca3af' }}
              />
              <Bar dataKey="requests" fill="#3b82f6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Recent failed requests */}
      {failed && failed.length > 0 && (
        <div className="bg-gray-900 border border-red-900/30 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-red-400 mb-4">Recent Failures ({failed.length})</h2>
          <div className="space-y-2">
            {failed.map((log: any) => (
              <LogRow key={log.id} log={log} />
            ))}
          </div>
        </div>
      )}

      {/* Recent requests */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-800">
          <h2 className="text-sm font-semibold text-gray-300">Recent Requests</h2>
        </div>
        <div className="overflow-x-auto">
          {recentLoading ? (
            <div className="p-4 text-gray-500 text-sm">Loading...</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b border-gray-800">
                  <th className="px-4 py-2">Time</th>
                  <th className="px-4 py-2">Provider</th>
                  <th className="px-4 py-2">Model</th>
                  <th className="px-4 py-2">Alias</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2 text-right">Latency</th>
                  <th className="px-4 py-2 text-right">Tokens</th>
                </tr>
              </thead>
              <tbody>
                {(recent ?? []).map((log: any) => (
                  <tr key={log.id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                    <td className="px-4 py-2 text-gray-500 whitespace-nowrap">
                      {new Date(log.createdAt).toLocaleTimeString()}
                    </td>
                    <td className="px-4 py-2 font-medium text-gray-300">{log.provider}</td>
                    <td className="px-4 py-2 text-gray-400 font-mono text-xs max-w-32 truncate">{log.model}</td>
                    <td className="px-4 py-2 text-gray-500">{log.modelAlias ?? '—'}</td>
                    <td className="px-4 py-2">
                      <span
                        className="px-1.5 py-0.5 rounded text-xs font-medium"
                        style={{
                          color: STATUS_COLORS[log.status] ?? '#9ca3af',
                          background: `${STATUS_COLORS[log.status]}20`,
                        }}
                      >
                        {log.status}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right text-gray-400">{log.latencyMs}ms</td>
                    <td className="px-4 py-2 text-right text-gray-500">{log.totalTokens > 0 ? log.totalTokens.toLocaleString() : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-gray-500">{label}</span>
        {icon}
      </div>
      <p className="text-2xl font-bold text-gray-100">{value}</p>
    </div>
  );
}

function LogRow({ log }: { log: any }) {
  return (
    <div className="flex items-center gap-3 text-sm p-2 bg-gray-800/50 rounded">
      <span className="text-gray-500 text-xs">{new Date(log.createdAt).toLocaleTimeString()}</span>
      <span className="font-medium text-gray-300">{log.provider}</span>
      <span
        className="px-1.5 py-0.5 rounded text-xs"
        style={{ color: STATUS_COLORS[log.status], background: `${STATUS_COLORS[log.status]}20` }}
      >
        {log.status}
      </span>
      <span className="text-gray-500 text-xs flex-1 truncate">{log.errorMessage}</span>
    </div>
  );
}
