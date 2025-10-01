import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';

// simple health + ping
const app = express();
const port = process.env.PORT || 5000;

// CORS: allow your Netlify/bolt site
app.use(cors({
  origin: [
    process.env.FRONTEND_URL || 'http://localhost:5173',
    'https://thelastryielts.com',
    'https://www.thelastryielts.com'
  ],
  credentials: false
}));

app.use(bodyParser.json({ limit: '2mb' }));

app.get('/', (_req, res) => {
  res.json({ ok: true, service: 'ielts-backend', time: new Date().toISOString() });
});

// --- routes go here (you can add your existing routes later) ---
// example
app.post('/api/ping', (req, res) => {
  res.json({ ok: true, echo: req.body || {} });
});

app.listen(port, () => {
  console.log(`✅ Server running on port ${port}`);
});
