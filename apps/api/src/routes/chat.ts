import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { apiKeyAuth } from '../middleware/auth';
import { routeRequest, routeStreamingRequest } from '../router';

const router = Router();

const messageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: z.string().nullable(),
  name: z.string().optional(),
  tool_calls: z.array(z.any()).optional(),
  tool_call_id: z.string().optional(),
});

const chatRequestSchema = z.object({
  model: z.string().min(1),
  messages: z.array(messageSchema).min(1),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().positive().optional(),
  top_p: z.number().min(0).max(1).optional(),
  stream: z.boolean().optional().default(false),
  tools: z.array(z.any()).optional(),
  tool_choice: z.any().optional(),
  stop: z.union([z.string(), z.array(z.string())]).optional(),
  user: z.string().optional(),
});

router.post('/v1/chat/completions', apiKeyAuth, async (req: Request, res: Response) => {
  const parse = chatRequestSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({
      error: {
        message: 'Invalid request body',
        type: 'invalid_request_error',
        details: parse.error.flatten(),
      },
    });
    return;
  }

  const chatReq = parse.data;
  // Model alias tracking: if the request model matches a known alias key, record it
  const modelAlias = chatReq.model;

  if (chatReq.stream) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    try {
      await routeStreamingRequest(chatReq, res, modelAlias);
    } catch (err) {
      if (!res.headersSent) {
        res.status(500).json({ error: { message: String(err) } });
      }
    }
    return;
  }

  try {
    const { response } = await routeRequest(chatReq, modelAlias);
    res.json(response);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(502).json({
      error: {
        message,
        type: 'provider_error',
        code: 'all_providers_failed',
      },
    });
  }
});

export default router;
