import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

// ESM imports (these point to compiled .js at runtime)
import { apiRoutes } from './routes/api.js';
import { gatekeeperRouter } from './routes/gatekeeper.js';
import { scoreWritingRouter } from './routes/score-writing.js';
import { detailedScoringRouter } from './routes/detailed-scoring.js';
import speakingAsrRouter from './routes/speaking-asr.js';
import speakingScorerRouter from './routes/speaking-scorer.js';
import paymentsRouter from './routes/payments.js';
import capiRouter from './routes/capi.js';
import { couponsRouter } from './routes/coupons.js';

// Razorpay webhook (RAW body BEFORE json parser)
import { webhookRawHandler } from './routes/razorpay-webhook.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT || 8080);

app.use(cors());

// Webhooks first (RAW body)
app.post('/webhooks/razorpay', express.raw({ type: 'application/json' }), webhookRawHandler);
app.post('/api/webhooks/razorpay', express.raw({ type: 'application/json' }), webhookRawHandler);

// JSON for everything else
app.use(express.json({ limit: '10mb' }));

// Static
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/audio', express.static(path.join(__dirname, 'data/audio')));

// API
app.use('/api', apiRoutes);
app.use('/api/gatekeeper', gatekeeperRouter);
app.use('/api/writing', scoreWritingRouter);
app.use('/api/writing', detailedScoringRouter);
app.use('/api/speaking', speakingAsrRouter);
app.use('/api/speaking', speakingScorerRouter);
app.use('/payments', paymentsRouter);
app.use('/api/payments', paymentsRouter);
app.use('/api/coupons', couponsRouter);
app.use('/capi', capiRouter);
app.use('/api/capi', capiRouter);

// Health
app.get('/health', (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`✅ Server listening on :${PORT}`);
});
