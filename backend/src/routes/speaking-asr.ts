import express from 'express';
import multer from 'multer';
import OpenAI from 'openai';
import { processTranscript } from '../utils/transcriptProcessor.js';

const router = express.Router();
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
    if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: 'OpenAI API key not configured' });

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const audioData = new Uint8Array(req.file.buffer);

    const tr = await openai.audio.transcriptions.create({
      model: 'whisper-1',
      file: audioData as any, // SDK accepts Uint8Array/stream; cast for TS
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
  } catch (err) {
    console.error('Transcription error:', err);
    res.status(500).json({ error: 'Transcription failed' });
  }
});

export default router;

