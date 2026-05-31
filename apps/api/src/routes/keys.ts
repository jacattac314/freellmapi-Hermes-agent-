/**
 * /admin/keys — CRUD for encrypted provider API keys.
 * Keys are stored AES-256-GCM encrypted in SQLite.
 * Requires ENCRYPTION_KEY env var to be set.
 */
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db/client';
import { encrypt, decrypt, encryptionAvailable } from '../lib/crypto';
import { clearCooldown } from '../services/ratelimit';
import { getAllProviders } from '../providers/registry';
import axios from 'axios';

const router = Router();

function requireEncryption(res: any): boolean {
  if (!encryptionAvailable()) {
    res.status(503).json({
      error: 'ENCRYPTION_KEY is not set. Add a 64-char hex key to your .env file.',
      hint: 'Generate with: openssl rand -hex 32',
    });
    return false;
  }
  return true;
}

// GET /admin/keys — list all keys (masked, no plaintext)
router.get('/admin/keys', async (_req, res) => {
  if (!requireEncryption(res)) return;
  try {
    const keys = await prisma.providerKey.findMany({
      orderBy: [{ platform: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        platform: true,
        label: true,
        status: true,
        enabled: true,
        baseUrl: true,
        createdAt: true,
        lastCheckedAt: true,
        // never return encryptedKey, iv, authTag
      },
    });
    res.json(keys);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

const addKeySchema = z.object({
  platform: z.string().min(1),
  apiKey: z.string().min(1),
  label: z.string().default(''),
  baseUrl: z.string().url().optional().or(z.literal('')),
});

// POST /admin/keys — add a new encrypted key
router.post('/admin/keys', async (req, res) => {
  if (!requireEncryption(res)) return;

  const parse = addKeySchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.flatten() });
    return;
  }

  const { platform, apiKey, label, baseUrl } = parse.data;

  const knownProviders = getAllProviders().map((p) => p.name);
  if (!knownProviders.includes(platform)) {
    res.status(400).json({ error: `Unknown platform "${platform}". Known: ${knownProviders.join(', ')}` });
    return;
  }

  try {
    const payload = encrypt(apiKey);
    const key = await prisma.providerKey.create({
      data: {
        platform,
        label,
        encryptedKey: payload.encrypted,
        iv: payload.iv,
        authTag: payload.authTag,
        baseUrl: baseUrl || null,
        status: 'active',
        enabled: true,
      },
      select: { id: true, platform: true, label: true, status: true, enabled: true, createdAt: true },
    });
    res.status(201).json(key);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// PATCH /admin/keys/:id — enable/disable or update label
router.patch('/admin/keys/:id', async (req, res) => {
  if (!requireEncryption(res)) return;
  const id = Number(req.params.id);

  const schema = z.object({
    enabled: z.boolean().optional(),
    label: z.string().optional(),
    status: z.enum(['active', 'invalid', 'exhausted']).optional(),
  });
  const parse = schema.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: parse.error.flatten() }); return; }

  try {
    const updated = await prisma.providerKey.update({
      where: { id },
      data: parse.data,
      select: { id: true, platform: true, label: true, status: true, enabled: true },
    });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// DELETE /admin/keys/:id — remove a key
router.delete('/admin/keys/:id', async (req, res) => {
  if (!requireEncryption(res)) return;
  const id = Number(req.params.id);
  try {
    const row = await prisma.providerKey.findUnique({ where: { id } });
    if (!row) { res.status(404).json({ error: 'Key not found' }); return; }
    await clearCooldown(row.platform, id);
    await prisma.providerKey.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// POST /admin/keys/:id/validate — test a stored key against its provider
router.post('/admin/keys/:id/validate', async (req, res) => {
  if (!requireEncryption(res)) return;
  const id = Number(req.params.id);

  try {
    const row = await prisma.providerKey.findUnique({ where: { id } });
    if (!row) { res.status(404).json({ error: 'Key not found' }); return; }

    const apiKey = decrypt({ encrypted: row.encryptedKey, iv: row.iv, authTag: row.authTag });
    const { getAllProviders } = await import('../providers/registry');
    const provider = getAllProviders().find((p) => p.name === row.platform);
    if (!provider) { res.status(400).json({ error: 'Unknown provider' }); return; }

    const baseUrl = row.baseUrl ?? provider.baseUrl;

    // Validate by hitting the /models endpoint with the key
    const response = await axios.get(`${baseUrl}/models`, {
      headers: provider.authHeader(apiKey),
      timeout: 8000,
      validateStatus: () => true,
    });

    const valid = response.status !== 401 && response.status !== 403;
    const newStatus = valid ? 'active' : 'invalid';

    await prisma.providerKey.update({
      where: { id },
      data: { status: newStatus, lastCheckedAt: new Date() },
    });

    res.json({ valid, status: newStatus, httpStatus: response.status });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

export default router;
