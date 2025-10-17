import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

// Routers (ESM => keep .js extensions)
import apiRouter from './routes/api.js';
import { gatekeeperRouter } from './routes/gatekeeper.js';
import { scoreWritingRouter } from './routes/score-writing.js';
import { detailedScoringRouter } from './routes/detailed-scoring.js';
import speakingAsrRouter from './routes/speaking-asr.js';
import speakingScorerRouter from './routes/speaking-scorer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Static (optional)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/audio', express.static(path.join(__dirname, 'data/audio')));

// Routes
app.use('/api', apiRouter);                     // lead, listening-set, writing-prompt, attempts, report
app.use('/api/gatekeeper', gatekeeperRouter);   // POST /api/gatekeeper/check
app.use('/api/writing', scoreWritingRouter);    // POST /api/writing/score-writing
app.use('/api/writing', detailedScoringRouter); // POST /api/writing/detailed-scoring
app.use('/api/speaking', speakingAsrRouter);    // POST /api/speaking/transcribe
app.use('/api/speaking', speakingScorerRouter); // POST /api/speaking/score

app.get('/health', (_req, res) => res.json({ ok: true }));

const PORT = Number(process.env.PORT || 8080);
app.listen(PORT, () => {
  console.log(`✅ Server listening on :${PORT}`);
});
