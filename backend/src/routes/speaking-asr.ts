// backend/src/routes/speaking-asr.ts
import express from 'express';
import multer from 'multer';
import OpenAI from 'openai';
import { processTranscript } from '../utils/transcriptProcessor.js';

const router = express.Router();

// 50 MB limit; memoryStorage is fine for short clips
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }
});

/**
 * POST /api/speaking/transcribe
 * form-data: audio (file)
 */
router.post('/transcribe', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No audio file provided' });
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: 'OpenAI API key not configured' });
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // Build a File/Blob for the SDK (Node 18 has global File, but add a fallback)
    const filename = req.file.originalname || 'audio.webm';
    const mime = req.file.mimetype || 'audio/webm';

    let fileForApi: any;
    if (typeof (global as any).File === 'function') {
      // Node 18+: global File is available
      fileForApi = new File([req.file.buffer], filename, { type: mime });
    } else {
      // Fallback: construct a Blob (works with the OpenAI SDK)
      const { Blob } = await import('node:buffer');
      fileForApi = new Blob([req.file.buffer], { type: mime });
      (fileForApi as any).name = filename; // hint name for SDK
    }

    // Choose your model:
    // - 'gpt-4o-mini-transcribe' (fast, low cost)
    // - 'whisper-1' (classic Whisper)
    const tr = await openai.audio.transcriptions.create({
      model: 'gpt-4o-mini-transcribe',
      file: fileForApi,
      response_format: 'verbose_json',
      temperature: 0
    });

    const rawText = (tr as any).text || '';
    const segments = (tr as any).segments || [];

    const processed = processTranscript(rawText, segments);

    res.json({
      transcript: processed.text,
      audioFeatures: processed.audioFeatures,
      segments
    });
  } catch (err: any) {
    console.error('Transcription error:', err?.response?.data || err?.message || err);
    res.status(500).json({ error: 'Transcription failed' });
  }
});

export default router;
