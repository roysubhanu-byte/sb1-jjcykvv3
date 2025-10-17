import 'dotenv/config';
import express from 'express';
import cors from 'cors';

// Routers
import gatekeeperRouter from './routes/gatekeeper.js';
import writingRouter from './routes/score-writing.js';
import speakingASRRouter from './routes/speaking-asr.js';
import speakingScoreRouter from './routes/speaking-scorer.js';
import listeningRouter from './routes/listening-score.js';

const app = express();

// --- CORS ---
const allowOrigin = process.env.FRONTEND_URL?.split(',').map(s => s.trim());
app.use(cors({
  origin: allowOrigin && allowOrigin.length > 0 ? allowOrigin : true,
  credentials: false,
}));

// --- Body parsing ---
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

// --- Health ---
app.get('/api/health', (_req, res) => res.json({ ok: true }));

// --- Routes ---
app.use('/api/gatekeeper', gatekeeperRouter);         // POST /api/gatekeeper/check
app.use('/api/writing', writingRouter);               // POST /api/writing/score
app.use('/api/speaking/asr', speakingASRRouter);      // POST /api/speaking/asr/transcribe
app.use('/api/speaking', speakingScoreRouter);        // POST /api/speaking/score
app.use('/api/listening', listeningRouter);           // POST /api/listening/score

// --- 404 ---
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

// --- Error handler ---
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = Number(process.env.PORT) || 3000;
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => console.log(`API up on :${PORT}`));
}

export default app;

