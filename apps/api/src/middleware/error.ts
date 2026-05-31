import type { Request, Response, NextFunction } from 'express';

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const status = (err as any).status ?? 500;
  console.error(`[error] ${req.method} ${req.path}: ${err.message}`);

  res.status(status).json({
    error: {
      message: err.message,
      type: 'api_error',
      code: status === 429 ? 'rate_limit_exceeded' : 'internal_error',
    },
  });
}
