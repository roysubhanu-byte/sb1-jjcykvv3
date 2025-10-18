// backend/src/routes/speaking-asr.ts
import express from 'express';
const router = express.Router();

import { processTranscript } from '../utils/transcript.js';

interface TranscribeBody {
  transcript?: string;           // raw ASR text (if you already have it)
  // if you send audio somewhere else, you can keep the fields you had before
}

router.post('/transcribe', async (req, res) => {
  try {
    const body: TranscribeBody = req.body || {};
    const raw = (body.transcript || '').toString();

    if (!raw.trim()) {
      return res.status(400).json({ error: 'Missing transcript text' });
    }

    // your own utility from utils/transcript.ts
    const processed = processTranscript(raw);

    // Build a response similar to what your scorer expects
    const minutes = Math.max(1, Math.round(processed.wordCount / 130)); // naive duration estimate
    const wpm = Math.round(processed.wordCount / minutes);

    const fillerRate =
      processed.wordCount > 0
        ? Number(((processed.fillerCount / processed.wordCount) * 100).toFixed(2))
        : 0;

    return res.json({
      ok: true,
      processed_text: processed.text,
      sentences: processed.sentences,
      word_count: processed.wordCount,
      filler_words: processed.fillerWords,
      filler_count: processed.fillerCount,
      metrics: {
        wpm,
        filler_rate_percent: fillerRate
      }
    });
  } catch (err: any) {
    console.error('speaking-asr /transcribe error:', err);
    return res.status(500).json({ error: 'ASR post-processing failed' });
  }
});

export default router;
