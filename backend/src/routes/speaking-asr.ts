import express from 'express';
import multer from 'multer';
import OpenAI from 'openai';
import { processTranscript } from '../utils/transcriptProcessor.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

/**
 * POST /api/speaking/transcribe
 * Body: multipart/form-data with field "audio"
 */
router.post('/transcribe', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No audio file provided' });
    if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: 'OpenAI API key not configured' });

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const transcription = await openai.audio.transcriptions.create({
      model: 'whisper-1', // or 'gpt-4o-mini-transcribe'
      file: new File([req.file.buffer], req.file.originalname || 'audio.webm', { type: req.file.mimetype }),
      response_format: 'verbose_json', // gives segments & timings
      temperature: 0
    });

    const rawText = transcription.text || '';
    const segments = (transcription as any).segments || [];

    const processed = processTranscript(rawText, segments);

    res.json({
      transcript: processed.text,
      audioFeatures: processed.audioFeatures,
      segments
    });
  } catch (err) {
    console.error('Transcription error:', err);
    res.status(500).json({ error: 'Transcription failed' });
  }
});

export default router;
