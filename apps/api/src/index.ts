import './config/env'; // validate env first
import express from 'express';
import cors from 'cors';
import { env } from './config/env';
import { prisma } from './db/client';
import healthRouter from './routes/health';
import modelsRouter from './routes/models';
import chatRouter from './routes/chat';
import adminRouter from './routes/admin';
import { errorHandler } from './middleware/error';

const app = express();

app.use(cors());
app.use(express.json({ limit: '4mb' }));

// Routes
app.use(healthRouter);
app.use(modelsRouter);
app.use(chatRouter);
app.use(adminRouter);

// Global error handler
app.use(errorHandler);

async function start() {
  // Ensure DB is reachable — migrate/push should be run separately
  try {
    await prisma.$connect();
    console.log('[db] Connected to SQLite database');
  } catch (err) {
    console.error('[db] Failed to connect. Run: npm run db:push -w apps/api');
    console.error(err);
    process.exit(1);
  }

  const server = app.listen(env.PORT, () => {
    console.log(`\n🚀  Free LLM API Router running at http://localhost:${env.PORT}`);
    console.log(`    /health          → service status`);
    console.log(`    /v1/models       → available model aliases`);
    console.log(`    /v1/chat/completions → OpenAI-compatible chat`);
    console.log(`    /admin/providers → provider status (dashboard)\n`);
  });

  // Graceful shutdown
  const shutdown = async () => {
    console.log('\n[server] Shutting down...');
    await prisma.$disconnect();
    server.close(() => process.exit(0));
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

// Only start the HTTP server when run directly (not when imported in tests)
if (require.main === module) {
  start();
}

export default app;
