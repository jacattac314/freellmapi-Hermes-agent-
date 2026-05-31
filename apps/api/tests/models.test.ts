import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import request from 'supertest';
import { prisma } from '../src/db/client';
import app from '../src/index';

beforeAll(async () => {
  await prisma.$connect();
});

describe('GET /v1/models', () => {
  afterEach(() => {
    delete process.env.FREE_LLM_API_KEY;
  });

  it('returns 200 with model list', async () => {
    const res = await request(app).get('/v1/models');
    expect(res.status).toBe(200);
    expect(res.body.object).toBe('list');
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
  });

  it('includes "fast", "smart", "code" aliases', async () => {
    const res = await request(app).get('/v1/models');
    const ids = res.body.data.map((m: any) => m.id);
    expect(ids).toContain('fast');
    expect(ids).toContain('smart');
    expect(ids).toContain('code');
  });

  it('each model has required fields', async () => {
    const res = await request(app).get('/v1/models');
    for (const model of res.body.data) {
      expect(model.id).toBeTruthy();
      expect(model.object).toBe('model');
      expect(typeof model.created).toBe('number');
      expect(model.owned_by).toBeTruthy();
    }
  });

  it('requires auth when FREE_LLM_API_KEY is set', async () => {
    process.env.FREE_LLM_API_KEY = 'test-secret';
    const res = await request(app).get('/v1/models');
    expect(res.status).toBe(401);
  });

  it('accepts correct bearer token', async () => {
    process.env.FREE_LLM_API_KEY = 'test-secret';
    const res = await request(app)
      .get('/v1/models')
      .set('Authorization', 'Bearer test-secret');
    expect(res.status).toBe(200);
  });
});
