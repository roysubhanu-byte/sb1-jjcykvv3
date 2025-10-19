import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

// Existing routers (ESM paths end with .js)
import { apiRoutes } from './routes/api.js';
import { gatekeeperRouter } from './routes/gatekeeper.js';
import { scoreWritingRouter } from './routes/score-writing.js';
import { detailedScoringRouter } from './routes/detailed-scoring.js';
import speakingAsrRouter from './routes/speaking-asr.js';
import speakingScorerRouter from './routes/speaking-scorer.js';

// NEW routers
import paymentsRouter from './routes/payments.js';
import capiRouter from './routes/capi.js';
import { couponsRouter } from './routes/coupons.js';

// Webhook handler (DEFAULT export)
import razorpayWebhook from './routes/razorpay-webhook.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT || 8080);

// CORS early
app.use(cors());

// -----------------------------
// Razorpay webhook MUST receive RAW body.
// Mount BEFORE express.json().
// Provide both paths just in case.
// -----------------------------
app.post('/webhooks/razorpay', express.raw({ type: 'application/json' }), razorpayWebhook);
app.post('/api/webhooks/razorpay', express.raw({ type: 'application/json' }), razorpayWebhook);

// JSON parser for everything else
app.use(express.json({ limit: '10mb' }));

// Static files
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/audio', express.static(path.join(__dirname, 'data/audio')));

// Existing API routes
app.use('/api', apiRoutes);
app.use('/api/gatekeeper', gatekeeperRouter);
app.use('/api/writing', scoreWritingRouter);
app.use('/api/writing', detailedScoringRouter);
app.use('/api/speaking', speakingAsrRouter);
app.use('/api/speaking', speakingScorerRouter);

// Payments / Coupons / CAPI (with /api aliases to match frontend)
app.use('/payments', paymentsRouter);            // /payments/order, /payments/verify, /payments/grant-access
app.use('/api/payments', paymentsRouter);        // alias

app.use('/api/coupons', couponsRouter);          // /api/coupons/validate, /record-usage

app.use('/capi', capiRouter);                    // /capi/purchase
app.use('/api/capi', capiRouter);                // alias

// Healthcheck
app.get('/health', (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`✅ Server listening on :${PORT}`);
});
