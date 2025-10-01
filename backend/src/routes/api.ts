import express from 'express';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs-extra';
import { v4 as uuidv4 } from 'uuid';

// IMPORTANT: paths are relative to src/routes/
// If your helper files are at backend/src/scoreWriting.ts etc,
// go up one level (../) and include the .ts extension for NodeNext.
import { scoreWriting } from '../utils/scoreWriting.ts';
import { sendEmailReport } from '../utils/emailService.ts';
import { generatePdfReport } from '../utils/pdfService.ts';


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// Data paths
const DATA_DIR = path.join(__dirname, '../data');
const LEADS_FILE = path.join(DATA_DIR, 'leads.ndjson');
const ATTEMPTS_DIR = path.join(DATA_DIR, 'attempts');
const UPLOADS_DIR = path.join(__dirname, '../uploads');

// Ensure directories exist
fs.ensureDirSync(DATA_DIR);
fs.ensureDirSync(path.join(DATA_DIR, 'listening'));
fs.ensureDirSync(path.join(DATA_DIR, 'writing'));
fs.ensureDirSync(path.join(DATA_DIR, 'audio'));
fs.ensureDirSync(ATTEMPTS_DIR);
fs.ensureDirSync(UPLOADS_DIR);

// POST /api/lead - Capture lead information
router.post('/lead', async (req, res) => {
  try {
    const { email, userAgent, utm, selfie_hash } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const leadData = {
      email,
      userAgent,
      utm,
      selfie_hash,
      timestamp: new Date().toISOString(),
      ip: req.ip
    };

    // Append to leads file
    await fs.appendFile(LEADS_FILE, JSON.stringify(leadData) + '\n');

    console.log('📧 New lead captured:', email);
    res.json({ ok: true });
  } catch (error) {
    console.error('Error saving lead:', error);
    res.status(500).json({ error: 'Failed to save lead' });
  }
});

// GET /api/listening-set - Return listening test set
router.get('/listening-set', async (_req, res) => {
  try {
    const setPath = path.join(DATA_DIR, 'listening/setA.json');

    // Check if file exists, create sample if not
    if (!(await fs.pathExists(setPath))) {
      await createSampleListeningSet();
    }

    const setData = await fs.readJson(setPath);
    res.json(setData);
  } catch (error) {
    console.error('Error loading listening set:', error);
    res.status(500).json({ error: 'Failed to load listening set' });
  }
});

// GET /api/writing-prompt - Return writing prompt
router.get('/writing-prompt', async (_req, res) => {
  try {
    const promptPath = path.join(DATA_DIR, 'writing/promptA.json');

    if (!(await fs.pathExists(promptPath))) {
      await createSampleWritingPrompt();
    }

    const promptData = await fs.readJson(promptPath);
    res.json(promptData);
  } catch (error) {
    console.error('Error loading writing prompt:', error);
    res.status(500).json({ error: 'Failed to load writing prompt' });
  }
});

// POST /api/attempts/complete - Process test completion
router.post('/attempts/complete', async (req, res) => {
  try {
    const { email, selfie_meta, listening, writing } = req.body;

    if (!email || !listening || !writing) {
      return res.status(400).json({ error: 'Missing required data' });
    }

    // Generate attempt ID
    const attemptId = uuidv4();

    // Compute listening band
    const listeningBand = computeListeningBand(listening.raw);

    // Load listening set for wrong question details
    const setPath = path.join(DATA_DIR, 'listening/setA.json');
    const listeningSet = await fs.readJson(setPath);

    // Analyze wrong answers
    const listeningReview = analyzeListeningErrors(listening.wrong_ids, listeningSet);

    // Score writing with AI
    const writingReview = await scoreWriting(writing.text);

    // Calculate overall band (nearest .5)
    const overallBand = Math.round(((listeningBand + writingReview.overall) / 2) * 2) / 2;

    // Generate 7-day plan
    const plan7d = generate7DayPlan(listeningBand, writingReview.overall, listeningReview, writingReview);

    // Compose final result
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
      plan7d
    };

    // Save attempt to disk
    const attemptPath = path.join(ATTEMPTS_DIR, `${attemptId}.json`);
    await fs.writeJson(attemptPath, result, { spaces: 2 });

    console.log(`📊 Test completed for ${email}, Overall Band: ${overallBand}`);
    res.json(result);
  } catch (error) {
    console.error('Error processing attempt:', error);
    res.status(500).json({ error: 'Failed to process test results' });
  }
});

// POST /api/report/email - Send email report
router.post('/report/email', async (req, res) => {
  try {
    const { email, result } = req.body;

    if (!email || !result) {
      return res.status(400).json({ error: 'Email and result data required' });
    }

    await sendEmailReport(email, result);
    console.log(`📧 Report emailed to ${email}`);
    res.json({ ok: true });
  } catch (error) {
    console.error('Error sending email:', error);
    res.status(500).json({ error: 'Failed to send email' });
  }
});

// GET /api/report/pdf - Generate PDF report
router.get('/report/pdf', async (req, res) => {
  try {
    const { attempt_id } = req.query;

    if (!attempt_id) {
      return res.status(400).json({ error: 'Attempt ID required' });
    }

    const attemptPath = path.join(ATTEMPTS_DIR, `${attempt_id}.json`);

    if (!(await fs.pathExists(attemptPath))) {
      return res.status(404).json({ error: 'Attempt not found' });
    }

    const attemptData = await fs.readJson(attemptPath);
    const pdfBuffer = await generatePdfReport(attemptData);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="IELTS-Diagnostic-${attempt_id}.pdf"`);
    res.send(pdfBuffer);
  } catch (error) {
    console.error('Error generating PDF:', error);
    res.status(500).json({ error: 'Failed to generate PDF' });
  }
});

// ---- Helpers ----
function computeListeningBand(rawScore: number): number {
  if (rawScore <= 1) return 4.5;
  if (rawScore <= 3) return 5.5;
  if (rawScore <= 5) return 6.5;
  return 7.5;
}

function analyzeListeningErrors(wrongIds: string[], listeningSet: any) {
  const tagCounts: Record<string, number> = {};
  const wrongItems: any[] = [];

  wrongIds.forEach((id) => {
    const item = listeningSet.items.find((i: any) => i.id === id);
    if (item) {
      wrongItems.push({
        id: item.id,
        explanation: item.explanation,
        paraphrases: item.paraphrases
      });

      // Count tags
      (item.tags || []).forEach((tag: string) => {
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      });
    }
  });

  // Get top 2 weak areas
  const sortedTags = Object.entries(tagCounts).sort(([, a], [, b]) => b - a).slice(0, 2);

  const synonymsSuggested = sortedTags.map(([tag]) => {
    switch (tag) {
      case 'inference':
        return 'Listen for conclusions implied, not stated; confirm with a second clue.';
      case 'numbers':
        return 'Write numbers as you hear; double-check units (kg, km).';
      case 'paraphrase':
        return 'Expect synonyms—map words like "purchase"↔"buy", "assist"↔"help".';
      case 'detail':
        return 'Focus on specific facts mentioned; avoid assumptions.';
      case 'main-idea':
        return 'Listen for topic sentences and concluding statements.';
      default:
        return `Practice ${tag} questions more frequently.`;
    }
  });

  return { wrong: wrongItems, synonyms_suggested: synonymsSuggested };
}

function generate7DayPlan(listeningBand: number, writingBand: number, listeningReview: any, writingReview: any): string[] {
  const plan: string[] = [];
  const overallBand = (listeningBand + writingBand) / 2;

  // Identify weaknesses/strengths
  const weaknesses: string[] = [];
  const strengths: string[] = [];

  if (listeningBand < 5.0) weaknesses.push('basic listening comprehension');
  else if (listeningBand < 6.0) weaknesses.push('academic listening skills');

  if (writingReview.tr && writingReview.tr < 5.0) weaknesses.push('task response');
  if (writingReview.cc && writingReview.cc < 5.0) weaknesses.push('coherence and cohesion');
  if (writingReview.lr && writingReview.lr < 5.0) weaknesses.push('vocabulary range/accuracy');
  if (writingReview.gra && writingReview.gra < 5.0) weaknesses.push('grammar and sentence structure');

  if (writingReview.off_topic) weaknesses.push('staying on topic');
  if (writingReview.template_likelihood && writingReview.template_likelihood > 0.5) weaknesses.push('using original language');
  if (writingReview.grammar_error_count && writingReview.grammar_error_count > 3) weaknesses.push('grammar accuracy');

  if (listeningBand >= 6.0) strengths.push('listening comprehension');
  if (writingBand >= 6.0) strengths.push('writing skills');

  let day1 = `Day 1: Analyze your results - Listening: ${listeningBand}, Writing: ${writingBand}, Overall: ${overallBand.toFixed(1)}. `;
  if (weaknesses.length > 0) day1 += `Priority weaknesses: ${weaknesses.slice(0, 3).join(', ')}. `;
  if (strengths.length > 0) day1 += `Maintain your ${strengths.join(' and ')}.`;
  plan.push(day1);

  if (listeningBand < 4.0) {
    plan.push('Day 2: Basic listening foundation - watch short videos with subtitles; focus on main ideas.');
  } else if (listeningBand < 5.0) {
    plan.push('Day 2: IELTS Listening Part 1 intensive — 3 sets, note-taking practice.');
  } else if (listeningBand < 6.0) {
    plan.push('Day 2: Parts 2–3 focus — academic/social contexts, paraphrase spotting.');
  } else if (listeningBand < 7.0) {
    plan.push('Day 2: Advanced — Part 4 lectures, complex arguments/details.');
  } else {
    plan.push('Day 2: Maintain excellence — academic lectures/podcasts.');
  }

  if (writingBand < 4.0) {
    plan.push('Day 3: Writing fundamentals — basic sentence structure; 5 simple correct sentences.');
  } else if (writingBand < 5.0) {
    plan.push('Day 3: Essay structure — clear intro/body/conclusion; one 200-word essay.');
  } else if (writingBand < 6.0) {
    plan.push('Day 3: Paragraph development — topic sentences, examples, explanations.');
  } else if (writingBand < 7.0) {
    plan.push('Day 3: Advanced argumentation — balanced arguments, complex but accurate grammar.');
  } else {
    plan.push('Day 3: Refinement — nuanced arguments, sophisticated language.');
  }

  let day4 = 'Day 4: ';
  if (writingReview.off_topic) {
    day4 += 'Topic focus training — plan essays that address all parts.';
  } else if (writingReview.template_likelihood && writingReview.template_likelihood > 0.5) {
    day4 += 'Original language — write 3 short paragraphs with your own expressions.';
  } else if (writingReview.grammar_error_count && writingReview.grammar_error_count > 3) {
    day4 += 'Grammar accuracy — targeted exercises based on your errors.';
  } else if (writingReview?.actions?.length) {
    day4 += `${writingReview.actions[0]}`;
  } else if (listeningReview?.synonyms_suggested?.length) {
    day4 += `${listeningReview.synonyms_suggested[0]}`;
  } else {
    day4 += 'Vocabulary & grammar reinforcement — 30 min focused review.';
  }
  plan.push(day4);

  if (listeningBand < writingBand - 1.0) {
    plan.push('Day 5: Listening-focused full practice test.');
  } else if (writingBand < listeningBand - 1.0) {
    plan.push('Day 5: Writing-intensive timed tasks (Task 1 + Task 2).');
  } else {
    plan.push('Day 5: Balanced test — do both listening and writing under exam timing.');
  }

  if (overallBand < 5.0) {
    plan.push('Day 6: Essentials — basic time management; quick question type ID; elimination techniques.');
  } else if (overallBand < 6.0) {
    plan.push('Day 6: Intermediate — advanced note-taking; fast paraphrase ID; 5-min essay planning.');
  } else {
    plan.push('Day 6: Advanced — prediction skills; complex essay structures; sophisticated vocabulary.');
  }

  if (overallBand < 6.0) {
    plan.push('Day 7: Comprehensive review — mini-test on problem areas; consider more foundation work.');
  } else if (overallBand < 7.0) {
    plan.push('Day 7: Progress assessment — new diagnostic; adjust plan.');
  } else {
    plan.push('Day 7: Maintenance — full practice test; focus on consistency and exam-day strategy.');
  }

  return plan;
}

// Create sample data if not exists
async function createSampleListeningSet() {
  const sampleSet = {
    set_id: 'LS-A1',
    audio_url: '/audio/lecture01.mp3',
    items: [
      {
        id: 'L1',
        stem: 'What is the lecture mainly about?',
        options: ['Pollution metrics', 'Marine biodiversity impacts', 'Fishing quotas', 'Tourism trends'],
        answer: 'Marine biodiversity impacts',
        explanation: 'Focus is on biodiversity effects.',
        tags: ['inference', 'main-idea'],
        paraphrases: ['marine life', 'species diversity', 'ecosystem impact'],
      },
      // ... keep your sample items
    ],
  };

  const setPath = path.join(DATA_DIR, 'listening/setA.json');
  await fs.ensureDir(path.dirname(setPath));
  await fs.writeJson(setPath, sampleSet, { spaces: 2 });
}

async function createSampleWritingPrompt() {
  const samplePrompt = {
    prompt_id: 'W-A1',
    text:
      'Some people think schools should teach only job-relevant subjects, while others prefer a broad curriculum. Discuss both views and give your opinion (120–150 words).',
  };

  const promptPath = path.join(DATA_DIR, 'writing/promptA.json');
  await fs.ensureDir(path.dirname(promptPath));
  await fs.writeJson(promptPath, samplePrompt, { spaces: 2 });
}

export { router as apiRoutes };
