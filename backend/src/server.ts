import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

// Routers (ESM imports must include .js for relative paths)
import { apiRoutes } from './routes/api.js';
import { gatekeeperRouter } from './routes/gatekeeper.js';
import { scoreWritingRouter } from './routes/score-writing.js';
import { detailedScoringRouter } from './routes/detailed-scoring.js';
import speakingAsrRouter from './routes/speaking-asr.js';
import speakingScorerRouter from './routes/speaking-scorer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT || 8080);

app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/audio', express.static(path.join(__dirname, 'data/audio')));

app.use('/api', apiRoutes);
app.use('/api/gatekeeper', gatekeeperRouter);
app.use('/api/writing', scoreWritingRouter);
app.use('/api/writing', detailedScoringRouter);
app.use('/api/speaking', speakingAsrRouter);
app.use('/api/speaking', speakingScorerRouter);

app.get('/health', (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`✅ Server listening on :${PORT}`);
});
