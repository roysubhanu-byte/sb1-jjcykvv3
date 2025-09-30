import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import path from 'path';
import { fileURLToPath } from 'url';

// Route modules (these must exist with regular hyphens)
import { apiRoutes } from './api.js';
import { scoreWritingRouter } from './score-writing.js';
import { gatekeeperRouter } from './gatekeeper.js';
import { detailedScoringRouter } from './detailed-scoring.js';

// __dirname / __filename for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(bodyParser.json({ limit: '5mb' }));
app.use(
  cors({
    origin: [process.env.FRONTEND_URL || 'http://localhost:5173', 'http://localhost:5173'],
    credentials: true,
  })
);

// Health check
app.get('/health', (_req, res) => res.send('ok'));

// Routes
app.use('/api', apiRoutes);
app.use('/score-writing', scoreWritingRouter);
app.use('/gatekeeper', gatekeeperRouter);
app.use('/detailed-scoring', detailedScoringRouter);

// Start
app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});

export default app;
