import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { getAllProviders, getProviderStatuses } from '../providers/registry';
import { getCooldowns, resetCooldown } from '../router';
import { getUsageStats, getRecentLogs, getFailedLogs } from '../db/usage';

const router = Router();
const MODELS_CONFIG_PATH = path.resolve(__dirname, '../config/models.json');

// GET /admin/providers — list all providers + their status
router.get('/admin/providers', async (_req, res) => {
  try {
    const cooldowns = getCooldowns();
    const statuses = await getProviderStatuses(cooldowns);
    res.json(statuses);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// DELETE /admin/cooldowns/:provider — manually clear a cooldown
router.delete('/admin/cooldowns/:provider', (req, res) => {
  const { provider } = req.params;
  resetCooldown(provider);
  res.json({ ok: true, message: `Cooldown cleared for ${provider}` });
});

// GET /admin/models — get current model alias config
router.get('/admin/models', (_req, res) => {
  try {
    const raw = fs.readFileSync(MODELS_CONFIG_PATH, 'utf-8');
    res.json(JSON.parse(raw));
  } catch {
    res.status(500).json({ error: 'Could not read models config' });
  }
});

// PUT /admin/models — overwrite model alias config
router.put('/admin/models', (req, res) => {
  try {
    const body = req.body;
    if (typeof body !== 'object' || Array.isArray(body)) {
      res.status(400).json({ error: 'Body must be a JSON object' });
      return;
    }
    // Basic validation: each value must be an array of {provider, model}
    for (const [alias, chain] of Object.entries(body)) {
      if (!Array.isArray(chain)) {
        res.status(400).json({ error: `"${alias}" must map to an array` });
        return;
      }
      for (const entry of chain) {
        if (typeof entry.provider !== 'string' || typeof entry.model !== 'string') {
          res.status(400).json({ error: `Each entry in "${alias}" must have provider and model strings` });
          return;
        }
      }
    }
    fs.writeFileSync(MODELS_CONFIG_PATH, JSON.stringify(body, null, 2));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// GET /admin/usage — aggregated usage stats
router.get('/admin/usage', async (_req, res) => {
  try {
    const stats = await getUsageStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// GET /admin/usage/recent — last N request logs
router.get('/admin/usage/recent', async (req, res) => {
  const limit = Math.min(Number(req.query.limit ?? 50), 200);
  try {
    const logs = await getRecentLogs(limit);
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// GET /admin/usage/failed — recent failed requests
router.get('/admin/usage/failed', async (req, res) => {
  const limit = Math.min(Number(req.query.limit ?? 20), 100);
  try {
    const logs = await getFailedLogs(limit);
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

export default router;
