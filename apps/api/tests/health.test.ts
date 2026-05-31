import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { prisma } from '../src/db/client';
import app from '../src/index';

beforeAll(async () => {
  await prisma.$connect();
});

describe('GET /health', () => {
  it('returns 200 with status ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('includes timestamp and provider arrays', async () => {
    const res = await request(app).get('/health');
    expect(res.body.timestamp).toBeDefined();
    expect(Array.isArray(res.body.enabledProviders)).toBe(true);
    expect(Array.isArray(res.body.activeCooldowns)).toBe(true);
  });
});
