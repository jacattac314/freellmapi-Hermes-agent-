/**
 * Sliding-window rate limit tracker with escalating cooldowns.
 *
 * In-memory sliding windows are authoritative within a process lifetime.
 * Cooldown state is persisted to SQLite so it survives restarts.
 *
 * Cooldown escalation (per platform+keyId, tracked in memory):
 *   1st 429 in 24h  →  2 minutes
 *   2nd             →  10 minutes
 *   3rd             →  1 hour
 *   4th+            →  24 hours (quota likely exhausted for the day)
 */

import { prisma } from '../db/client';

const MINUTE = 60_000;
const HOUR   = 60 * MINUTE;
const DAY    = 24 * HOUR;

const COOLDOWN_DURATIONS = [2 * MINUTE, 10 * MINUTE, HOUR, DAY];

// In-memory sliding windows: `platform:keyId:rpm|rpd` → timestamps[]
const requestWindows = new Map<string, number[]>();

// In-memory cooldown hit counts for escalation: `platform:keyId` → timestamps[]
const cooldownHits = new Map<string, number[]>();

// In-memory cooldown expiry cache: `platform:keyId` → expiresAtMs
const cooldownCache = new Map<string, number>();

// --- Sliding window helpers ---

function getWindow(key: string): number[] {
  if (!requestWindows.has(key)) requestWindows.set(key, []);
  return requestWindows.get(key)!;
}

function pruneWindow(key: string, windowMs: number): number[] {
  const now = Date.now();
  const cutoff = now - windowMs;
  const w = getWindow(key).filter((ts) => ts > cutoff);
  requestWindows.set(key, w);
  return w;
}

/** Count requests within windowMs for a platform+key */
export function requestCount(platform: string, keyId: number, windowMs: number): number {
  const type = windowMs === MINUTE ? 'rpm' : 'rpd';
  return pruneWindow(`${platform}:${keyId}:${type}`, windowMs).length;
}

/** Record a request for rate-limit tracking */
export function recordRequest(platform: string, keyId: number): void {
  const now = Date.now();
  getWindow(`${platform}:${keyId}:rpm`).push(now);
  getWindow(`${platform}:${keyId}:rpd`).push(now);
  // Fire-and-forget DB persistence
  prisma.rateLimitUsage.create({
    data: { platform, keyId, kind: 'request', tokens: 0, createdAtMs: BigInt(now) },
  }).catch(() => {});
}

/** Check whether a key can make a new request given its rate limits */
export function canMakeRequest(
  platform: string,
  keyId: number,
  limits: { rpm: number | null; rpd: number | null },
): boolean {
  if (limits.rpm !== null && requestCount(platform, keyId, MINUTE) >= limits.rpm) return false;
  if (limits.rpd !== null && requestCount(platform, keyId, DAY) >= limits.rpd) return false;
  return true;
}

// --- Escalating cooldowns ---

function escalatingDuration(platform: string, keyId: number): number {
  const key = `${platform}:${keyId}`;
  const now = Date.now();
  const hits = (cooldownHits.get(key) ?? []).filter((t) => t > now - DAY);
  hits.push(now);
  cooldownHits.set(key, hits);
  const idx = Math.min(hits.length - 1, COOLDOWN_DURATIONS.length - 1);
  return COOLDOWN_DURATIONS[idx]!;
}

export async function setCooldown(
  platform: string,
  keyId: number,
  durationMs?: number,
): Promise<void> {
  const duration = durationMs ?? escalatingDuration(platform, keyId);
  const expiresAtMs = Date.now() + duration;
  const cacheKey = `${platform}:${keyId}`;
  cooldownCache.set(cacheKey, expiresAtMs);

  await prisma.rateLimitCooldown.upsert({
    where: { platform_keyId: { platform, keyId } },
    create: { platform, keyId, expiresAtMs: BigInt(expiresAtMs) },
    update: { expiresAtMs: BigInt(expiresAtMs) },
  }).catch(() => {});
}

export async function isOnCooldown(platform: string, keyId: number): Promise<boolean> {
  const cacheKey = `${platform}:${keyId}`;
  const now = Date.now();

  // Check in-memory cache first
  const cached = cooldownCache.get(cacheKey);
  if (cached !== undefined) {
    if (now < cached) return true;
    cooldownCache.delete(cacheKey);
    return false;
  }

  // Fall back to DB (e.g. after restart)
  try {
    const row = await prisma.rateLimitCooldown.findUnique({
      where: { platform_keyId: { platform, keyId } },
    });
    if (!row) return false;
    const expiry = Number(row.expiresAtMs);
    if (now < expiry) {
      cooldownCache.set(cacheKey, expiry); // warm cache
      return true;
    }
    await prisma.rateLimitCooldown.delete({
      where: { platform_keyId: { platform, keyId } },
    }).catch(() => {});
    return false;
  } catch {
    return false;
  }
}

export async function clearCooldown(platform: string, keyId: number): Promise<void> {
  cooldownCache.delete(`${platform}:${keyId}`);
  await prisma.rateLimitCooldown.deleteMany({ where: { platform, keyId } }).catch(() => {});
}

/** Clear all in-memory state (used in tests) */
export function clearAllCooldownsForTest(): void {
  cooldownCache.clear();
  cooldownHits.clear();
  requestWindows.clear();
}

/** Purge rate_limit_usage rows older than 24h (call periodically) */
export async function pruneUsage(): Promise<void> {
  const cutoff = BigInt(Date.now() - DAY);
  await prisma.rateLimitUsage.deleteMany({
    where: { createdAtMs: { lt: cutoff } },
  }).catch(() => {});
}
