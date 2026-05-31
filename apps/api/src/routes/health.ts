import { Router } from 'express';
import { getEnabledProviders } from '../providers/registry';
import { getCooldowns } from '../router';

const router = Router();

router.get('/health', (_req, res) => {
  const enabled = getEnabledProviders();
  const cooldowns = getCooldowns();
  const activeCooldowns = Array.from(cooldowns.entries())
    .filter(([, until]) => until > new Date())
    .map(([name, until]) => ({ name, until: until.toISOString() }));

  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    enabledProviders: enabled.map((p) => p.name),
    activeCooldowns,
  });
});

export default router;
