import { prisma } from './client';

export interface LogRequestParams {
  provider: string;
  model: string;
  modelAlias: string | null;
  keyId?: number | null;
  status: 'success' | 'error' | 'timeout' | 'rate_limited';
  latencyMs: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  errorMessage: string | null;
}

export async function logRequest(params: LogRequestParams): Promise<void> {
  try {
    await prisma.requestLog.create({ data: params });
  } catch (err) {
    // Don't let a DB write failure break the response
    console.error('[db] Failed to log request:', err);
  }
}

export async function getUsageStats() {
  const logs = await prisma.requestLog.findMany({
    orderBy: { createdAt: 'desc' },
  });

  const total = logs.length;
  const successful = logs.filter((l) => l.status === 'success').length;
  const avgLatency = total > 0 ? Math.round(logs.reduce((s, l) => s + l.latencyMs, 0) / total) : 0;
  const totalTokens = logs.reduce((s, l) => s + l.totalTokens, 0);

  // Group by provider
  const providerMap = new Map<string, typeof logs>();
  for (const log of logs) {
    const existing = providerMap.get(log.provider) ?? [];
    existing.push(log);
    providerMap.set(log.provider, existing);
  }

  const byProvider = Array.from(providerMap.entries()).map(([provider, pLogs]) => {
    const pTotal = pLogs.length;
    const pSuccess = pLogs.filter((l) => l.status === 'success').length;
    return {
      provider,
      requests: pTotal,
      successRate: pTotal > 0 ? Math.round((pSuccess / pTotal) * 100) : 0,
      avgLatencyMs: pTotal > 0 ? Math.round(pLogs.reduce((s, l) => s + l.latencyMs, 0) / pTotal) : 0,
      totalTokens: pLogs.reduce((s, l) => s + l.totalTokens, 0),
    };
  });

  return {
    totalRequests: total,
    successRate: total > 0 ? Math.round((successful / total) * 100) : 0,
    avgLatencyMs: avgLatency,
    totalTokens,
    byProvider,
  };
}

export async function getRecentLogs(limit = 50) {
  return prisma.requestLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

export async function getFailedLogs(limit = 20) {
  return prisma.requestLog.findMany({
    where: { status: { not: 'success' } },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}
