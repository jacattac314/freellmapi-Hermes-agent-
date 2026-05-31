import { execSync } from 'child_process';
import path from 'path';

// Use a dedicated test database so tests don't pollute dev.db
process.env.DATABASE_URL = 'file:./test.db';
process.env.NODE_ENV = 'test';

// Push schema to test DB before any tests run
try {
  execSync('npx prisma db push --schema=prisma/schema.prisma --skip-generate', {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: 'file:./test.db' },
    stdio: 'pipe',
  });
} catch (err) {
  console.error('Failed to push test schema:', err);
}
