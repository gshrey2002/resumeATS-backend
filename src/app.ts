import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { connectDB } from './lib/db';
import { analyzeRouter } from './routes/analyze.route';
import { optimizeRouter } from './routes/optimize.route';
import { compileRouter } from './routes/compile.route';
import { authRouter } from './routes/auth.route';
import { resumeRouter } from './routes/resume.route';
import { requireAuth } from './middleware/auth.middleware';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({
  origin: [
    process.env.FRONTEND_URL || 'http://localhost:3000',
    'http://localhost:3001',
  ],
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/analyze', requireAuth, analyzeRouter);
app.use('/api/optimize', requireAuth, optimizeRouter);
app.use('/api/compile', requireAuth, compileRouter);
app.use('/api/auth', authRouter);
app.use('/api/resumes', resumeRouter);

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

async function start() {
  await connectDB();
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

start();

export default app;
