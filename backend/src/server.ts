import dotenv from 'dotenv';
dotenv.config();

import { fileURLToPath } from 'url';
import path from 'path';
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';

import { scoreWritingRouter } from './routes/score-writing.js';
import { gatekeeperRouter } from './routes/gatekeeper.js';
import { detailedScoringRouter } from './routes/detailed-scoring.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = Number(process.env.PORT) || 5000;

// --- CORS (allow your domains) ---
const allowedOrigins = (process.env.FRONTEND_URL || '').split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (allowedOrigins.length === 0) return cb(null, true);
    const ok = allowedOrigins.some(a => {
      if (a.includes('*')) {
        const re = new RegExp('^' + a.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$');
        return re.test(origin);
      }
      return origin === a;
    });
    return ok ? cb(null, true) : cb(new Error('Not allowed by CORS'));
  },
  credentials: true
}));

// --- parsers ---
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true }));

// --- minimal request log ---
app.use((req, _res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
  next();
});

// --- static ---
app.use('/audio', express.static(path.join(__dirname, 'data', 'audio')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// --- routes ---
app.use('/api', gatekeeperRouter);
app.use('/api', scoreWritingRouter);
app.use('/api', detailedScoringRouter);

// --- health ---
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'OK',
    ts: new Date().toISOString(),
    model: process.env.OPENAI_MODEL || 'gpt-4o',
    hasOpenAI: !!process.env.OPENAI_API_KEY,
    hasSupabaseUrl: !!process.env.SUPABASE_URL,
    hasSupabaseRole: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
  });
});

// --- error handler ---
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// --- start ---
app.listen(port, () => {
  console.log(`🚀 Server running on http://localhost:${port}`);
  console.log(`🔧 Model: ${process.env.OPENAI_MODEL || 'gpt-4o'}`);
});
