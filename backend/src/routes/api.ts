     import express, { Request, Response } from 'express';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs-extra';
import { v4 as uuidv4 } from 'uuid';

// keep .js extensions because we compile as NodeNext ESM
import { scoreWriting } from '../utils/scoreWriting.js';
import { sendEmailReport } from '../utils/emailService.js';
import { generatePdfReport } from '../utils/pdfService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

const DATA_DIR = path.join(__dirname, '../data');
const LEADS_FILE = path.join(DATA_DIR, 'leads.ndjson');
const ATTEMPTS_DIR = path.join(DATA_DIR, 'attempts');
const UPLOADS_DIR = path.join(__dirname, '../uploads');

fs.ensureDirSync(DATA_DIR);
fs.ensureDirSync(path.join(DATA_DIR, 'listening'));
fs.ensureDirSync(path.join(DATA_DIR, 'writing'));
fs.ensureDirSync(path.join(DATA_DIR, 'audio'));
fs.ensureDirSync(ATTEMPTS_DIR);
fs.ensureDirSync(UPLOADS_DIR);

/** POST /api/lead */
router.post('/lead', async (req: Request, res: Response) => {
  try {
    const { email, userAgent, utm, selfie_hash } = (req.body ?? {}) as Record<string, any>;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const lead = {
      email,
      userAgent,
      utm,
      selfie_hash,
      timestamp: new Date().toISOString(),
      ip: (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || ''
    };

    await fs.appendFile(LEADS_FILE, JSON.stringify(lead) + '\n', 'utf8');
    res.json({ ok: true });
  } catch (e) {
    console.error('Error saving lead:', e);
    res.status(500).json({ error: 'Failed to save lead' });
  }
});

/** GET /api/listening-set */
router.get('/listening-set', async (_req: Request, res: Response) => {
  try {
    const setPath = path.join(DATA_DIR, 'listening/setA.json');
    if (!(await fs.pathExists(setPath))) await createSampleListeningSet(setPath);
    const set = await fs.readJson(setPath);
    res.json(set);
  } catch (e) {
    console.error('Error loading listening set:', e);
    res.status(500).json({ error: 'Failed to load listening set' });
  }
});

/** GET /api/writing-prompt */
router.get('/writing-prompt', async (_req: Request, res: Response) => {
  try {
    const promptPath = path.join(DATA_DIR, 'writing/promptA.json');
    if (!(await fs.pathExists(promptPath))) await createSampleWritingPrompt(promptPath);
    const prompt = await fs.readJson(promptPath);
    res.json(prompt);
  } catch (e) {
    console.error('Error loading writing prompt:', e);
    res.status(500).json({ error: 'Failed to load writing prompt' });
  }
});

/** POST /api/attempts/complete */
router.post('/attempts/complete', async (req: Request, res: Response) => {
  try {
    const { email, selfie_meta, listening, writing } = (req.body ?? {}) as any;
    if (!email || !listening || !writing) {
      return res.status(400).json({ error: 'Missing required data' });
    }

    const attemptId = uuidv4();

    const listeningBand = computeListeningBand(listening.raw);

    const setPath = path.join(DATA_DIR, 'listening/setA.json');
    const listeningSet = await fs.readJson(setPath);
    const listeningReview = analyzeListeningErrors(listening.wrong_ids, listeningSet);

    const writingReview = await scoreWriting(writing.text);
    const overallBand = Math.round(((listeningBand + writingReview.overall) / 2) * 2) / 2;

    const plan7d = generate7DayPlan(listeningBand, writingReview.overall, listeningReview, writingReview);

    const result = {
      attempt_id: attemptId,
      email,
      timestamp: new Date().toISOString(),
      selfie_meta,
      bands: { listening: listeningBand, writing: writingReview.overall, overall: overallBand },
      listening_review: listeningReview,
      writing_review: writingReview,
      plan7d
    };

    await fs.writeJson(path.join(ATTEMPTS_DIR, `${attemptId}.json`), result, { spaces: 2 });
    res.json(result);
  } catch (e) {
    console.error('Error processing attempt:', e);
    res.status(500).json({ error: 'Failed to process test results' });
  }
});

/** POST /api/report/email */
router.post('/report/email', async (req: Request, res: Response) => {
  try {
    const { email, result } = (req.body ?? {}) as any;
    if (!email || !result) return res.status(400).json({ error: 'Email and result data required' });

    await sendEmailReport(email, result);
    res.json({ ok: true });
  } catch (e) {
    console.error('Error sending email:', e);
    res.status(500).json({ error: 'Failed to send email' });
  }
});

/** GET /api/report/pdf?attempt_id=ID */
router.get('/report/pdf', async (req: Request, res: Response) => {
  try {
    const attempt_id = String(req.query.attempt_id || '');
    if (!attempt_id) return res.status(400).json({ error: 'Attempt ID required' });

    const attemptPath = path.join(ATTEMPTS_DIR, `${attempt_id}.json`);
    if (!(await fs.pathExists(attemptPath))) return res.status(404).json({ error: 'Attempt not found' });

    const attemptData = await fs.readJson(attemptPath);
    const pdfBuffer = await generatePdfReport(attemptData);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="IELTS-Diagnostic-${attempt_id}.pdf"`);
    res.send(pdfBuffer);
  } catch (e) {
    console.error('Error generating PDF:', e);
    res.status(500).json({ error: 'Failed to generate PDF' });
  }
});

// ---------- Helpers ----------
function computeListeningBand(raw: number): number {
  if (raw <= 1) return 4.5;
  if (raw <= 3) return 5.5;
  if (raw <= 5) return 6.5;
  return 7.5;
}

function analyzeListeningErrors(wrongIds: string[], listeningSet: any) {
  const tagCounts: Record<string, number> = {};
  const wrongItems: any[] = [];

  (wrongIds || []).forEach((id: string) => {
    const item = (listeningSet.items || []).find((i: any) => i.id === id);
    if (item) {
      wrongItems.push({
        id: item.id,
        explanation: item.explanation,
        paraphrases: item.paraphrases
      });
      (item.tags || []).forEach((tag: string) => {
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      });
    }
  });

  const sorted = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 2);
  const synonymsSuggested = sorted.map(([tag]) => {
    switch (tag) {
      case 'inference': return 'Listen for implied conclusions; confirm with a second clue.';
      case 'numbers': return 'Write numbers as heard; double-check units (kg, km).';
      case 'paraphrase': return 'Expect synonyms—map “purchase”↔“buy”, “assist”↔“help”.';
      case 'detail': return 'Focus on specific facts; avoid assumptions.';
      case 'main-idea': return 'Catch the topic sentence and closing line.';
      default: return `Practice ${tag} items more frequently.`;
    }
  });

  return { wrong: wrongItems, synonyms_suggested: synonymsSuggested };
}

function generate7DayPlan(
  listeningBand: number,
  writingBand: number,
  listeningReview: any,
  writingReview: any
): string[] {
  const plan: string[] = [];
  const overallBand = (listeningBand + writingBand) / 2;

  const weaknesses: string[] = [];
  const strengths: string[] = [];

  if (listeningBand < 5.0) weaknesses.push('basic listening comprehension');
  else if (listeningBand < 6.0) weaknesses.push('academic listening skills');

  if (writingReview.tr && writingReview.tr < 5.0) weaknesses.push('task response');
  if (writingReview.cc && writingReview.cc < 5.0) weaknesses.push('coherence');
  if (writingReview.lr && writingReview.lr < 5.0) weaknesses.push('vocabulary range');
  if (writingReview.gra && writingReview.gra < 5.0) weaknesses.push('grammar accuracy');

  if (listeningBand >= 6.0) strengths.push('listening comprehension');
  if (writingBand >= 6.0) strengths.push('writing skills');

  let day1 = `Day 1: Analyze results — Listening ${listeningBand}, Writing ${writingBand}, Overall ${overallBand.toFixed(1)}. `;
  if (weaknesses.length) day1 += `Priority weaknesses: ${weaknesses.slice(0, 3).join(', ')}. `;
  if (strengths.length) day1 += `Maintain your ${strengths.join(' and ')}.`;
  plan.push(day1);

  if (listeningBand < 4.0) plan.push('Day 2: Basic listening — videos with subtitles 30 min. Focus on main ideas.');
  else if (listeningBand < 5.0) plan.push('Day 2: Listening Part 1 intensive — 3 sets, practice note-taking.');
  else if (listeningBand < 6.0) plan.push('Day 2: Parts 2–3 focus — paraphrases & synonyms.');
  else if (listeningBand < 7.0) plan.push('Day 2: Part 4 lectures — complex arguments and details.');
  else plan.push('Day 2: Maintain excellence — academic lectures/podcasts.');

  if (writingBand < 4.0) plan.push('Day 3: Writing fundamentals — sentence structure 45 min; 5 correct sentences.');
  else if (writingBand < 5.0) plan.push('Day 3: Essay structure — intro + PEEL paragraphs + conclusion; 200 words.');
  else if (writingBand < 6.0) plan.push('Day 3: Paragraph development — topic sentences + examples + explanation.');
  else if (writingBand < 7.0) plan.push('Day 3: Advanced argumentation — balanced ideas, complex grammar accurately.');
  else plan.push('Day 3: Refinement — nuanced arguments and flawless execution.');

  let day4 = 'Day 4: ';
  if (writingReview.off_topic) day4 += 'Topic focus — plan essays to address all parts; 3 planning drills.';
  else if (writingReview.grammar_error_count > 3) day4 += 'Grammar accuracy — targeted drills from your error log.';
  else if (writingReview?.actions?.length) day4 += writingReview.actions[0];
  else if (listeningReview?.synonyms_suggested?.length) day4 += listeningReview.synonyms_suggested[0];
  else day4 += 'Vocabulary + grammar reinforcement — 30 min.';
  plan.push(day4);

  if (listeningBand < writingBand - 1.0) plan.push('Day 5: Listening practice test (full) under time.');
  else if (writingBand < listeningBand - 1.0) plan.push('Day 5: Writing Task 1 + Task 2 under time (60 min).');
  else plan.push('Day 5: Balanced mini-test for both skills.');

  if (overallBand < 6.0) plan.push('Day 6: Essential time management + elimination techniques.');
  else plan.push('Day 6: Advanced techniques — prediction in listening, sophisticated vocabulary.');

  plan.push('Day 7: Comprehensive review + mini-test.');

  return plan;
}

async function createSampleListeningSet(setPath: string) {
  const sampleSet = {
    set_id: 'LS-A1',
    audio_url: '/audio/lecture01.mp3',
    items: [
      { id: 'L1', stem: 'What is the lecture mainly about?', options: ['Pollution metrics', 'Marine biodiversity impacts', 'Fishing quotas', 'Tourism trends'], answer: 'Marine biodiversity impacts', explanation: 'Focus is on biodiversity effects.', tags: ['inference', 'main-idea'], paraphrases: ['marine life', 'species diversity', 'ecosystem impact'] },
      { id: 'L2', stem: 'According to the speaker, the decline is primarily due to…', options: ['coastal construction', 'overfishing', 'temperature rise', 'noise pollution'], answer: 'temperature rise', explanation: 'They cite warming waters.', tags: ['detail', 'paraphrase'] },
      { id: 'L3', stem: 'The speaker mentions that coral reefs support what percentage of marine species?', options: ['15%', '25%', '35%', '45%'], answer: '25%', explanation: '25% depend on reefs.', tags: ['numbers', 'detail'] },
      { id: 'L4', stem: 'What solution does the speaker suggest?', options: ['Reducing tourism', 'Creating marine protected areas', 'Limiting fishing seasons', 'Building artificial reefs'], answer: 'Creating marine protected areas', explanation: 'Primary solution mentioned.', tags: ['inference', 'solution'] },
      { id: 'L5', stem: "The speaker's tone when discussing the future is:", options: ['optimistic', 'pessimistic', 'neutral', 'uncertain'], answer: 'cautiously optimistic', explanation: 'Hope with challenges.', tags: ['inference', 'tone'] },
      { id: 'L6', stem: 'What does the speaker say about international cooperation?', options: ["It's unnecessary", "It's essential", "It's difficult", "It's expensive"], answer: "It's essential", explanation: 'Emphasized as needed.', tags: ['detail', 'paraphrase'] }
    ]
  };
  await fs.ensureDir(path.dirname(setPath));
  await fs.writeJson(setPath, sampleSet, { spaces: 2 });
}

async function createSampleWritingPrompt(promptPath: string) {
  const samplePrompt = {
    prompt_id: 'W-A1',
    text: 'Some people think schools should teach only job-relevant subjects, while others prefer a broad curriculum. Discuss both views and give your opinion (120–150 words).'
  };
  await fs.ensureDir(path.dirname(promptPath));
  await fs.writeJson(promptPath, samplePrompt, { spaces: 2 });
}

export default router;
