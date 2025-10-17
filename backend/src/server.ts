// backend/src/server.ts
import express from 'express';
import cors from 'cors';

import { apiRouter } from './routes/api';
import { gatekeeperRouter } from './routes/gatekeeper';
import { scoreWritingRouter } from './routes/score-writing';
import { detailedScoringRouter } from './routes/detailed-scoring';
import { speakingAsrRouter } from './routes/speaking-asr';
import { speakingScorerRouter } from './routes/speaking-scorer';

const app = express();

app.use(cors());
app.use(express.json({ limit: '5mb' }));

app.use('/api', apiRouter);
app.use('/api/gatekeeper', gatekeeperRouter);
app.use('/api/score-writing', scoreWritingRouter);
app.use('/api/detailed-scoring', detailedScoringRouter);
app.use('/api/speaking/asr', speakingAsrRouter);
app.use('/api/speaking/score', speakingScorerRouter);

const port = process.env.PORT || 3001;
app.listen(port, () => console.log(`API listening on ${port}`));


