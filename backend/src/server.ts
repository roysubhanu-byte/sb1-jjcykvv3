import dotenv from 'dotenv';
dotenv.config();

import { fileURLToPath } from 'url';
import path from 'path';
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import { apiRoutes } from './routes/api.js';
import { scoreWritingRouter } from './routes/score-writing.js';
import { gatekeeperRouter } from './routes/gatekeeper.js';
import { detailedScoringRouter } from './routes/detailed-scoring.js';
import { gatekeeperRouter } from './routes/gatekeeper.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors({
  origin: [
    process.env.FRONTEND_URL || 'http://localhost:5173',
    'http://localhost:5173',
    'https://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:5174'
  ],
  credentials: true
}));

app.use(bodyParser.json({ limit: '10mb' })); // Increased limit for base64 images
app.use(bodyParser.urlencoded({ extended: true }));

// Add request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Serve static files (audio, uploads)
app.use('/audio', express.static(path.join(__dirname, 'data/audio')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// API Routes
app.use('/api', apiRoutes);
app.use('/api', scoreWritingRouter);
app.use('/api', gatekeeperRouter);
app.use('/api', detailedScoringRouter);
app.use('/api', gatekeeperRouter);

// Health check
app.get('/', (req, res) => {
  res.json({ message: 'IELTS Diagnostic Backend is running!', timestamp: new Date().toISOString() });
});

// Add a specific test endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    env: {
      hasOpenAI: !!process.env.OPENAI_API_KEY,
      hasSupabase: !!process.env.SUPABASE_URL,
      port: process.env.PORT || 5000
    }
  });
});

// Error handling middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(port, () => {
  console.log(`🚀 Server running on http://localhost:${port}`);
  console.log(`📁 Data directory: ${path.join(__dirname, 'data')}`);
  console.log(`🔑 OpenAI API Key: ${process.env.OPENAI_API_KEY ? 'Configured' : 'Missing'}`);
  console.log(`🗄️ Supabase URL: ${process.env.SUPABASE_URL ? 'Configured' : 'Missing'}`);
  console.log(`🔐 Supabase Service Key: ${process.env.SUPABASE_SERVICE_ROLE_KEY ? 'Configured' : 'Missing'}`);
});
