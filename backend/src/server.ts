import express, { Request, Response } from 'express';
import cors from 'cors';
import { apiRouter } from './routes/api.js';

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 3001;

app.use(cors());
app.use(express.json({ limit: '3mb' }));

// health
app.get('/health', (_req: Request, res: Response) => {
  res.json({ ok: true });
});

// mount all API routes under /api
app.use('/api', apiRouter);

// 404
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

// error handler (last)
app.use(
  (
    err: any,
    _req: Request,
    res: Response,
    _next: express.NextFunction
  ) => {
    console.error('UNHANDLED ERROR:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
);

app.listen(PORT, () => {
  console.log(`Server listening on :${PORT}`);
});
