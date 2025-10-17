import express, { Request, Response } from 'express';
import cors from 'cors';
import path from 'path';

import apiRouter from './routes/api.js';
import { gatekeeperRouter } from './routes/gatekeeper.js';
import { scoreWritingRouter } from './routes/score-writing.js';
import { detailedScoringRouter } from './routes/detailed-scoring.js';
import { speakingAsrRouter } from './routes/speaking-asr.js';
import { speakingScorerRouter } from './routes/speaking-scorer.js';

const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// static (pdf/audio if you serve any)
app.use('/public', express.static(path.join(process.cwd(), 'public')));

// health
app.get('/health', (_req: Request, res: Response) => res.json({ ok: true }));

// routes
app.use('/api', apiRouter);
app.use('/api', gatekeeperRouter);
app.use('/api', scoreWritingRouter);
app.use('/api', detailedScoringRouter);
app.use('/api', speakingAsrRouter);
app.use('/api', speakingScorerRouter);

// IMPORTANT: DO NOT import or mount /listening-score (we're not using it)

const port = process.env.PORT ? Number(process.env.PORT) : 3001;
app.listen(port, () => {
  console.log(`✅ Backend listening on :${port}`);
});
