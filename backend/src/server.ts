import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

// ESM paths end with .js in the built output
import { apiRoutes } from './routes/api.js';
import { gatekeeperRouter } from './routes/gatekeeper.js';
import { scoreWritingRouter } from './routes/score-writing.js';
import { detailedScoringRouter } from './routes/detailed-scoring.js';
import speakingAsrRouter from './routes/speaking-asr.js';
import speakingScorerRouter from './routes/speaking-scorer.js';
import paymentsRouter from './routes/payments.js';
import capiRouter from './routes/capi.js';
import { couponsRouter } from './routes/coupons.js';

import { webhookRawHandler } from './routes/razorpay-webhook.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT || 8080);

// CORS first
app.use(cors());

// --- Webhooks (RAW body, BEFORE json parser) ---
app.post('/webhooks/razorpay', express.raw({ type: 'application/json' }), webhookRawHandler);
app.post('/api/webhooks/razorpay', express.raw({ type: 'application/json' }), webhookRawHandler);

// --- JSON parser for normal routes ---
app.use(express.json({ limit: '10mb' }));

// Static
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/audio', express.static(path.join(__dirname, 'data/audio')));

// API routes
app.use('/api', apiRoutes);
app.use('/api/gatekeeper', gatekeeperRouter);
app.use('/api/writing', scoreWritingRouter);
app.use('/api/writing', detailedScoringRouter);
app.use('/api/speaking', speakingAsrRouter);
app.use('/api/speaking', speakingScorerRouter);

// Payments / Coupons / CAPI (aliases preserved)
app.use('/payments', paymentsRouter);
app.use('/api/payments', paymentsRouter);
app.use('/api/coupons', couponsRouter);
app.use('/capi', capiRouter);
app.use('/api/capi', capiRouter);

// Healthcheck
app.get('/health', (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`✅ Server listening on :${PORT}`);
});
