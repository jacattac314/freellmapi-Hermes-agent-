import type { Request, Response, NextFunction } from 'express';
import { env } from '../config/env';

/**
 * Optional bearer-token guard for /v1 endpoints.
 * If FREE_LLM_API_KEY is set in the environment, requests to /v1/*
 * must include "Authorization: Bearer <key>". Skipped when key is unset.
 */
export function apiKeyAuth(req: Request, res: Response, next: NextFunction): void {
  // Read at request time to allow runtime changes (e.g. in tests)
  const requiredKey = process.env.FREE_LLM_API_KEY;
  if (!requiredKey) {
    return next();
  }

  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      error: {
        message: 'Missing Authorization header. Expected: Bearer <FREE_LLM_API_KEY>',
        type: 'invalid_request_error',
        code: 'missing_api_key',
      },
    });
    return;
  }

  const provided = authHeader.slice(7);
  if (provided !== requiredKey) {
    res.status(401).json({
      error: {
        message: 'Invalid API key.',
        type: 'invalid_request_error',
        code: 'invalid_api_key',
      },
    });
    return;
  }

  next();
}
