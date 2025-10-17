import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';

import gatekeeperRouter from './routes/gatekeeper.js';
import scoreWritingRouter from './routes/score-writing.js';
import speakingASRRouter from './routes/speaking-asr.js';
import speakingScorerRouter from './routes/speaking-scorer.js';

const app = express();

app.use(cors());
app.use(bodyParser.json({ limit: '15mb' }));
app.use(bodyParser.urlencoded({ extended: true }));

app.get('/health', (_req, res) => res.json({ ok: true }));

// Feature routers
app.use('/api/gatekeeper', gatekeeperRouter);
app.use('/api/writing', scoreWritingRouter);
app.use('/api/speaking', speakingASRRouter);     // /transcribe
app.use('/api/speaking', speakingScorerRouter);  // /score

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`API listening on :${PORT}`));
