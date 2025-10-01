import dotenv from 'dotenv';
dotenv.config();

import { fileURLToPath } from 'url';
import path from 'path';
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';

// IMPORTANT: Use .js in import specifiers (NodeNext + ESM)
// server.ts
import { apiRoutes } from './routes/api.js';
import { gatekeeperRouter } from './routes/gatekeeper.js';
import { scoreWritingRouter } from './routes/score-writing.js';
import { detailedScoringRouter } from './routes/detailed-scoring.js';

// routes/api.ts (note capital W to match the filename!)
import { scoreWriting } from '../utils/scoreWriting.js';


// __dirname shim for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 5000;

// CORS
app.use(
  cors({
    origin: [
      process.env.FRONTEND_URL || 'http://localhost:5173',
      'http://localhost:5173',
      'https://localhost:5173',
      'http://127.0.0.1:5173',
      'http://localhost:5174',
      'https://www.thelasttryielts.com',
      'https://thelasttryielts.com'
    ],
    credentials: true
  })
);

// Parsers
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true }));

// Request log
app.use((req, _res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Static
app.use('/audio', express.static(path.join(__dirname, 'data/audio')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Routes
app.use('/api', apiRoutes);
app.use('/api', gatekeeperRouter);
app.use('/api', scoreWritingRouter);
app.use('/api', detailedScoringRouter);

// Health
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    env: {
      hasOpenAI: !!process.env.OPENAI_API_KEY,
      hasSupabase: !!process.env.SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY,
      port: process.env.PORT || 5000
    }
  });
});

// Error handler
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Listen
app.listen(port, () => {
  console.log(`🚀 Server running on http://localhost:${port}`);
  console.log(`📁 Data directory: ${path.join(__dirname, 'data')}`);
  console.log(`🔑 OpenAI API Key: ${process.env.OPENAI_API_KEY ? 'Configured' : 'Missing'}`);
  console.log(`🧰 Supabase URL: ${process.env.SUPABASE_URL ? 'Configured' : 'Missing'}`);
  console.log(`🔐 Supabase Service Key: ${process.env.SUPABASE_SERVICE_ROLE_KEY ? 'Configured' : 'Missing'}`);
});
