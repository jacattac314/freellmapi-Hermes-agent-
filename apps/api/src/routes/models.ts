import { Router } from 'express';
import { apiKeyAuth } from '../middleware/auth';
import modelAliases from '../config/models.json';
import type { ModelsResponse } from '@freellmapi/shared';

const router = Router();

router.get('/v1/models', apiKeyAuth, (_req, res) => {
  const aliases = modelAliases as Record<string, Array<{ provider: string; model: string }>>;
  const now = Math.floor(Date.now() / 1000);

  // Expose each alias as a virtual model id, plus the raw provider/model combos
  const seen = new Set<string>();
  const data: ModelsResponse['data'] = [];

  // Add alias model IDs
  for (const alias of Object.keys(aliases)) {
    data.push({ id: alias, object: 'model', created: now, owned_by: 'freellmapi' });
    seen.add(alias);
  }

  // Add underlying provider/model pairs as "provider/model" ids
  for (const entries of Object.values(aliases)) {
    for (const { provider, model } of entries) {
      const id = `${provider}/${model}`;
      if (!seen.has(id)) {
        data.push({ id, object: 'model', created: now, owned_by: provider });
        seen.add(id);
      }
    }
  }

  const response: ModelsResponse = { object: 'list', data };
  res.json(response);
});

export default router;
