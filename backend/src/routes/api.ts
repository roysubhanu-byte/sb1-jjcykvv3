import express from 'express';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs-extra';
import { v4 as uuidv4 } from 'uuid';

// IMPORTANT: use .js specifiers and exact filename casing
import { scoreWriting } from '../utils/scoreWriting.js';

import { sendEmailReport } from '../utils/emailService.js';
import { generatePdfReport } from '../utils/pdfService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// Data paths
const DATA_DIR = path.join(__dirname, '../data');
const LEADS_FILE = path.join(DATA_DIR, 'leads.ndjson');
const ATTEMPTS_DIR = path.join(DATA_DIR, 'attempts');

// Ensure directories exist
fs.ensureDirSync(DATA_DIR);
fs.ensureDirSync(path.join(DATA_DIR, 'listening'));
fs.ensureDirSync(path.join(DATA_DIR, 'writing'));
fs.ensureDirSync(path.join(DATA_DIR, 'audio'));
fs.ensureDirSync(ATTEMPTS_DIR);

// POST /api/lead
router.post('/lead', async (req, res) => {
  try {
    const { email, userAgent, utm, selfie_hash } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    await fs.appendFile(
      LEADS_FILE,
      JSON.stringify({ email, userAgent, utm, selfie_hash, timestamp: new Date().toISOString(), ip: req.ip }) + '\n'
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('Error saving lead:', err);
    res.status(500).json({ error: 'Failed to save lead' });
  }
});

// GET /api/listening-set
router.get('/listening-set', async (_req, res) => {
  try {
    const setPath = path.join(DATA_DIR, 'listening/setA.json');
    if (!await fs.pathExists(setPath)) await createSampleListeningSet(setPath);
    res.json(await fs.readJson(setPath));
  } catch (err) {
    console.error('Error loading listening set:', err);
    res.status(500).json({ error: 'Failed to load listening set' });
  }
});

// GET /api/writing-prompt
router.get('/writing-prompt', async (_req, res) => {
  try {
    const promptPath = path.join(DATA_DIR, 'writing/promptA.json');
    if (!await fs.pathExists(promptPath)) await createSampleWritingPrompt(promptPath);
    res.json(await fs.readJson(promptPath));
  } catch (err) {
    console.error('Error loading writing prompt:', err);
    res.status(500).json({ error: 'Failed to load writing prompt' });
  }
});

// POST /api/attempts/complete
router.post('/attempts/complete', async (req, res) => {
  try {
    const { email, listening, writing } = req.body;
    if (!email || !listening || !writing) return res.status(400).json({ error: 'Missing required data' });

    const attemptId = uuidv4();

    const setPath = path.join(DATA_DIR, 'listening/setA.json');
    const listeningSet = await fs.readJson(setPath);
    const listeningBand = computeListeningBand(listening.raw);
    const listeningReview = analyzeListeningErrors(listening.wrong_ids, listeningSet);

    const writingReview = await scoreWriting(writing.text);
    const overallBand = Math.round(((listeningBand + writingReview.overall) / 2) * 2) / 2;

    const result = {
      attempt_id: attemptId,
      email,
      timestamp: new Date().toISOString(),
      bands: {
        listening: listeningBand,
        writing: writingReview.overall,
        overall: overallBand
      },
      listening_review: listeningReview,
      writing_review: writingReview,
      plan7d: generate7DayPlan(listeningBand, writingReview.overall, listeningReview, writingReview)
    };

    await fs.writeJson(path.join(ATTEMPTS_DIR, `${attemptId}.json`), result, { spaces: 2 });

    res.json(result);
  } catch (err) {
    console.error('Error processing attempt:', err);
    res.status(500).json({ error: 'Failed to process test results' });
  }
});

// POST /api/report/email
router.post('/report/email', async (req, res) => {
  try {
    const { email, result } = req.body;
    if (!email || !result) return res.status(400).json({ error: 'Email and result data required' });
    await sendEmailReport(email, result);
    res.json({ ok: true });
  } catch (err) {
    console.error('Error sending email:', err);
    res.status(500).json({ error: 'Failed to send email' });
  }
});

// GET /api/report/pdf
router.get('/report/pdf', async (req, res) => {
  try {
    const { attempt_id } = req.query as { attempt_id?: string };
    if (!attempt_id) return res.status(400).json({ error: 'Attempt ID required' });

    const attemptPath = path.join(ATTEMPTS_DIR, `${attempt_id}.json`);
    if (!await fs.pathExists(attemptPath)) return res.status(404).json({ error: 'Attempt not found' });

    const attemptData = await fs.readJson(attemptPath);
    const pdfBuffer = await generatePdfReport(attemptData);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="IELTS-Diagnostic-${attempt_id}.pdf"`);
    res.send(pdfBuffer);
  } catch (err) {
    console.error('Error generating PDF:', err);
    res.status(500).json({ error: 'Failed to generate PDF' });
  }
});

// Helpers (same as before)
function computeListeningBand(rawScore: number): number {
  if (rawScore <= 1) return 4.5;
  if (rawScore <= 3) return 5.5;
  if (rawScore <= 5) return 6.5;
  return 7.5;
}

function analyzeListeningErrors(wrongIds: string[], listeningSet: any) {
  const tagCounts: Record<string, number> = {};
  const wrongItems: any[] = [];
  wrongIds?.forEach((id) => {
    const item = listeningSet.items.find((i: any) => i.id === id);
    if (item) {
      wrongItems.push({ id: item.id, explanation: item.explanation, paraphrases: item.paraphrases });
      item.tags.forEach((tag: string) => { tagCounts[tag] = (tagCounts[tag] || 0) + 1; });
    }
  });
  const sortedTags = Object.entries(tagCounts).sort(([,a],[,b]) => b - a).slice(0, 2);
  const synonymsSuggested = sortedTags.map(([tag]) => {
    switch (tag) {
      case 'inference': return 'Listen for implied conclusions; confirm with a second clue.';
      case 'numbers': return 'Write numbers as you hear; double-check units.';
      case 'paraphrase': return 'Map purchase↔buy, assist↔help, etc.';
      case 'detail': return 'Focus on specific stated facts.';
      case 'main-idea': return 'Catch topic sentences & conclusions.';
      default: return `Practice ${tag} more often.`;
    }
  });
  return { wrong: wrongItems, synonyms_suggested: synonymsSuggested };
}

function generate7DayPlan(listeningBand: number, writingBand: number, listeningReview: any, writingReview: any): string[] {
  const plan: string[] = [];
  const overallBand = (listeningBand + writingBand) / 2;
  const weak: string[] = []; const strong: string[] = [];
  if (listeningBand < 5.0) weak.push('basic listening'); else if (listeningBand < 6.0) weak.push('academic listening');
  if (writingReview.tr && writingReview.tr < 5.0) weak.push('task response');
  if (writingReview.cc && writingReview.cc < 5.0) weak.push('coherence & cohesion');
  if (writingReview.lr && writingReview.lr < 5.0) weak.push('vocabulary');
  if (writingReview.gra && writingReview.gra < 5.0) weak.push('grammar');
  if (listeningBand >= 6.0) strong.push('listening');
  if (writingBand >= 6.0) strong.push('writing');
  plan.push(`Day 1: Analyze — L:${listeningBand}, W:${writingBand}, Overall:${overallBand.toFixed(1)}. Focus: ${weak.slice(0,3).join(', ')}. Keep: ${strong.join(' & ')}`);
  plan.push('Day 2: Listening practice (parts 2–4). Work paraphrases & notes.');
  plan.push('Day 3: Essay structure and paragraph development. Write one practice essay.');
  plan.push('Day 4: Grammar & vocabulary reinforcement (30 min).');
  plan.push('Day 5: Balanced practice test under exam conditions; review mistakes.');
  plan.push('Day 6: Strategies — quick paraphrase spotting; 5-min essay planning.');
  plan.push('Day 7: Mini-diagnostic and adjust.');
  return plan;
}

async function createSampleListeningSet(setPath: string) {
  const sample = {
    set_id: 'LS-A1',
    audio_url: '/audio/lecture01.mp3',
    items: [
      { id: 'L1', stem: 'What is the lecture mainly about?', options: ['Pollution','Marine biodiversity impacts','Quotas','Tourism'], answer: 'Marine biodiversity impacts', explanation: 'Biodiversity effects.', tags: ['inference','main-idea'], paraphrases: ['marine life','ecosystem impact'] },
      { id: 'L2', stem: 'The decline is primarily due to…', options: ['construction','overfishing','temperature rise','noise'], answer: 'temperature rise', explanation: 'Warming waters.', tags: ['detail','paraphrase'] }
    ]
  };
  await fs.ensureDir(path.dirname(setPath));
  await fs.writeJson(setPath, sample, { spaces: 2 });
}

async function createSampleWritingPrompt(promptPath: string) {
  const sample = { prompt_id: 'W-A1', text: 'Some people think schools should teach only job-relevant subjects, while others prefer a broad curriculum. Discuss both views and give your opinion (120–150 words).' };
  await fs.ensureDir(path.dirname(promptPath));
  await fs.writeJson(promptPath, sample, { spaces: 2 });
}

export { router as apiRoutes };
