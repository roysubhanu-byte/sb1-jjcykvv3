// backend/src/routes/api.ts
import express from 'express';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs-extra';
import { v4 as uuidv4 } from 'uuid';
import { createClient } from '@supabase/supabase-js';
import { scoreWriting } from '../utils/scoreWriting';
import { sendEmailReport } from '../utils/emailService';
import { generatePdfReport } from '../utils/pdfService';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// ---------- Supabase (service role) ----------
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = supabaseUrl && supabaseServiceKey
  ? createClient(supabaseUrl, supabaseServiceKey, { auth: { persistSession: false } })
  : null;

// ---------- Free Diagnostic Listening config ----------
const DIAGNOSTIC_FORM_ID  = 'FORM_A1';
const DIAGNOSTIC_MODULE   = 'Academic';
const DIAGNOSTIC_SECTION  = 'Listening';
const DIAGNOSTIC_Q_START  = 11;
const DIAGNOSTIC_Q_END    = 20;

// ---------- Data paths (fallback/sample) ----------
const DATA_DIR     = path.join(__dirname, '../data');
const LEADS_FILE   = path.join(DATA_DIR, 'leads.ndjson');
const ATTEMPTS_DIR = path.join(DATA_DIR, 'attempts');
const UPLOADS_DIR  = path.join(__dirname, '../uploads');

// Ensure directories exist
fs.ensureDirSync(DATA_DIR);
fs.ensureDirSync(path.join(DATA_DIR, 'listening'));
fs.ensureDirSync(path.join(DATA_DIR, 'writing'));
fs.ensureDirSync(path.join(DATA_DIR, 'audio'));
fs.ensureDirSync(ATTEMPTS_DIR);
fs.ensureDirSync(UPLOADS_DIR);

/* ==============================
   Lead capture
   ============================== */
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

    await fs.appendFile(LEADS_FILE, JSON.stringify(leadData) + '\n');
    console.log('📧 New lead captured:', email);
    res.json({ ok: true });
  } catch (error) {
    console.error('Error saving lead:', error);
    res.status(500).json({ error: 'Failed to save lead' });
  }
});

/* ==============================
   Listening set (DB-first, fallback to JSON)
   ============================== */
router.get('/listening-set', async (_req, res) => {
  try {
    if (!supabase) {
      console.warn('[listening-set] Supabase not configured, using JSON fallback');
      const setPath = path.join(DATA_DIR, 'listening/setA.json');
      if (!(await fs.pathExists(setPath))) {
        await createSampleListeningSet();
      }
      const setData = await fs.readJson(setPath);
      return res.json(setData);
    }

    console.log('[listening-set] Querying Supabase items for diagnostic set');
    const { data: items, error } = await supabase
      .from('items')
      .select('*')
      .eq('module', DIAGNOSTIC_MODULE)
      .eq('section', DIAGNOSTIC_SECTION)
      .eq('form_id', DIAGNOSTIC_FORM_ID)
      .gte('question_no', DIAGNOSTIC_Q_START)
      .lte('question_no', DIAGNOSTIC_Q_END)
      .order('question_no', { ascending: true });

    if (error) {
      console.error('[listening-set] Supabase error:', error);
      return res.status(500).json({ error: 'Failed to load listening set from database' });
    }

    if (!items || items.length === 0) {
      console.warn('[listening-set] No DB items found; returning empty payload');
      return res.json({
        set_id: `${DIAGNOSTIC_FORM_ID}_L_${DIAGNOSTIC_Q_START}_${DIAGNOSTIC_Q_END}`,
        audio_url: null,
        items: []
      });
    }

    const transformedItems = items.map((item: any) => ({
      id: item.item_id,
      stem: item.stem || '',
      options: Array.isArray(item.options_json) ? item.options_json : [],
      answer: item.correct_answer || '',
      explanation: item.explanation || '',
      tags: Array.isArray(item.tags) ? item.tags : []
    }));

    // Use the first audio_url if present; your frontend can also read per-item audio_url if needed
    const audioUrl = items[0]?.audio_url || null;

    return res.json({
      set_id: `${DIAGNOSTIC_FORM_ID}_L_${DIAGNOSTIC_Q_START}_${DIAGNOSTIC_Q_END}`,
      audio_url: audioUrl,
      items: transformedItems
    });
  } catch (error) {
    console.error('[listening-set] Unexpected error:', error);
    res.status(500).json({ error: 'Failed to load listening set' });
  }
});

/* ==============================
   Writing prompt (file-based sample)
   ============================== */
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

/* ==============================
   Attempt completion (legacy file-based demo flow)
   NOTE: Your production flow should use /api/attempts/:id/finish
         which finalizes an existing attempt in Supabase.
   ============================== */
router.post('/attempts/complete', async (req, res) => {
  try {
    const { email, selfie_meta, listening, writing } = req.body;

    if (!email || !listening || !writing) {
      return res.status(400).json({ error: 'Missing required data' });
    }

    const attemptId = uuidv4();

    // Business rule: diagnostic listening cap at 6.5
    const listeningBand = computeListeningBand(listening.raw);

    // Fallback set (only used for wrong-id explanations here)
    const setPath = path.join(DATA_DIR, 'listening/setA.json');
    const listeningSet = (await fs.pathExists(setPath))
      ? await fs.readJson(setPath)
      : { items: [] };

    const listeningReview = analyzeListeningErrors(listening.wrong_ids, listeningSet);

    const writingReview = await scoreWriting(writing.text);

    // Overall = mean(listening, writing) → rounded to nearest 0.5
    const overallBand = Math.round(((listeningBand + (writingReview.overall || 0)) / 2) * 2) / 2;

    const plan7d = generate7DayPlan(listeningBand, writingReview.overall || 0, listeningReview, writingReview);

    const result = {
      attempt_id: attemptId,
      email,
      timestamp: new Date().toISOString(),
      bands: {
        listening: listeningBand,
        writing: writingReview.overall || 0,
        overall: overallBand
      },
      listening_review: listeningReview,
      writing_review: writingReview,
      plan7d
    };

    const attemptPath = path.join(ATTEMPTS_DIR, `${attemptId}.json`);
    await fs.writeJson(attemptPath, result, { spaces: 2 });

    console.log(`📊 Test completed for ${email}, Overall Band: ${overallBand}`);
    res.json(result);
  } catch (error) {
    console.error('Error processing attempt:', error);
    res.status(500).json({ error: 'Failed to process test results' });
  }
});

/* ==============================
   Email the report
   ============================== */
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

/* ==============================
   Download PDF report
   ============================== */
router.get('/report/pdf', async (req, res) => {
  try {
    const { attempt_id } = req.query as { attempt_id?: string };

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

/* ==============================
   Helpers
   ============================== */

// DIAGNOSTIC CAP: max 6.5 for Listening
function computeListeningBand(rawScore: number): number {
  if (rawScore <= 1) return 4.5;
  if (rawScore <= 3) return 5.5;
  if (rawScore <= 5) return 6.5;
  return 6.5; // capped (was 7.5)
}

function analyzeListeningErrors(wrongIds: string[] = [], listeningSet: any) {
  const tagCounts: Record<string, number> = {};
  const wrongItems: any[] = [];

  (wrongIds || []).forEach((id) => {
    const item = listeningSet.items?.find((i: any) => i.id === id);
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

  const sortedTags = Object.entries(tagCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 2);

  const synonymsSuggested = sortedTags.map(([tag]) => {
    switch (tag) {
      case 'inference':
        return 'Listen for implied conclusions; confirm with a second clue.';
      case 'numbers':
        return 'Write numbers as heard; double-check units (kg, km).';
      case 'paraphrase':
        return 'Expect synonyms—map “purchase”↔“buy”, “assist”↔“help”.';
      case 'detail':
        return 'Focus on stated specifics; avoid assumptions.';
      case 'main-idea':
        return 'Catch topic sentences & conclusions for gist.';
      default:
        return `Practice ${tag} question types more often.`;
    }
  });

  return {
    wrong: wrongItems,
    synonyms_suggested: synonymsSuggested
  };
}

function generate7DayPlan(
  listeningBand: number,
  writingBand: number,
  listeningReview: any,
  writingReview: any
): string[] {
  const plan: string[] = [];
  const overallBand = (listeningBand + (writingBand || 0)) / 2;

  const weaknesses: string[] = [];
  const strengths: string[] = [];

  if (listeningBand < 5.0) weaknesses.push('basic listening comprehension');
  else if (listeningBand < 6.0) weaknesses.push('academic listening skills');

  if (writingReview?.tr && writingReview.tr < 5.0) weaknesses.push('task response');
  if (writingReview?.cc && writingReview.cc < 5.0) weaknesses.push('coherence & cohesion');
  if (writingReview?.lr && writingReview.lr < 5.0) weaknesses.push('vocabulary range');
  if (writingReview?.gra && writingReview.gra < 5.0) weaknesses.push('grammar accuracy');
  if (writingReview?.off_topic) weaknesses.push('staying on topic');
  if (writingReview?.template_likelihood > 0.5) weaknesses.push('original phrasing');
  if (writingReview?.grammar_error_count > 3) weaknesses.push('grammar errors');

  if (listeningBand >= 6.0) strengths.push('listening comprehension');
  if (writingBand >= 6.0) strengths.push('writing fundamentals');

  let day1 = `Day 1: Analyze your results - Listening: ${listeningBand}, Writing: ${writingBand}, Overall: ${overallBand.toFixed(
    1
  )}. `;
  if (weaknesses.length) day1 += `Priority weaknesses: ${weaknesses.slice(0, 3).join(', ')}. `;
  if (strengths.length) day1 += `Maintain your ${strengths.join(' and ')}.`;
  plan.push(day1);

  if (listeningBand < 4.0)
    plan.push('Day 2: Foundation—watch 30 mins with subtitles; focus on main ideas.');
  else if (listeningBand < 5.0)
    plan.push('Day 2: Part 1 focus—3 sets; practice note-taking during audio.');
  else if (listeningBand < 6.0)
    plan.push('Day 2: Parts 2–3—train paraphrase recognition & details.');
  else if (listeningBand < 7.0)
    plan.push('Day 2: Part 4—academic lectures; track argument structure.');
  else plan.push('Day 2: Maintain with authentic university lectures.');

  if (writingBand < 4.0)
    plan.push('Day 3: Writing basics—5 correct sentences; fix SVA & punctuation.');
  else if (writingBand < 5.0)
    plan.push('Day 3: Structure—write intro + 2 body + conclusion (200 words).');
  else if (writingBand < 6.0)
    plan.push('Day 3: Develop paragraphs—topic sentence + example + explanation.');
  else if (writingBand < 7.0)
    plan.push('Day 3: Advanced argumentation—balance & complex structures.');
  else plan.push('Day 3: Refinement—nuanced ideas & flawless execution.');

  let day4 = 'Day 4: ';
  if (writingReview?.off_topic)
    day4 += 'Topic focus—plan 3 essays; underline each task requirement.';
  else if (writingReview?.template_likelihood > 0.5)
    day4 += 'Original phrasing—write 3 short paras avoiding templates.';
  else if (writingReview?.grammar_error_count > 3)
    day4 += 'Grammar focus—drill your top 3 error types.';
  else if (writingReview?.actions?.length)
    day4 += `${writingReview.actions[0]} — do targeted drills.`;
  else if (listeningReview?.synonyms_suggested?.length)
    day4 += `${listeningReview.synonyms_suggested[0]} — synonym recognition practice.`;
  else day4 += 'Vocab & grammar reinforcement—30 mins targeted practice.';
  plan.push(day4);

  if (listeningBand < writingBand - 1.0)
    plan.push('Day 5: Listening mock—full set; review every mistake.');
  else if (writingBand < listeningBand - 1.0)
    plan.push('Day 5: Writing—Task 1 + Task 2 timed (60 mins).');
  else plan.push('Day 5: Balanced mock—both sections under exam timing.');

  if (overallBand < 5.0)
    plan.push('Day 6: Time & basics—master 20/40 split; quick Q-type ID.');
  else if (overallBand < 6.0)
    plan.push('Day 6: Intermediate—advanced note-taking & 5-min essay plans.');
  else plan.push('Day 6: Advanced—prediction skills & complex structures.');

  if (overallBand < 6.0)
    plan.push('Day 7: Review weakest areas + mini-test; build foundations.');
  else if (overallBand < 7.0)
    plan.push('Day 7: Re-diagnostic; adjust plan based on gaps.');
  else plan.push('Day 7: Full practice to maintain level.');

  return plan;
}

// -------- Sample data creators (for fallback) --------
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
        paraphrases: ['marine life', 'species diversity', 'ecosystem impact']
      },
      {
        id: 'L2',
        stem: 'According to the speaker, the decline is primarily due to…',
        options: ['coastal construction', 'overfishing', 'temperature rise', 'noise pollution'],
        answer: 'temperature rise',
        explanation: 'They cite warming waters.',
        tags: ['detail', 'paraphrase']
      },
      {
        id: 'L3',
        stem: 'The speaker mentions that coral reefs support what percentage of marine species?',
        options: ['15%', '25%', '35%', '45%'],
        answer: '25%',
        explanation: 'The speaker states 25% of marine species depend on coral reefs.',
        tags: ['numbers', 'detail']
      },
      {
        id: 'L4',
        stem: 'What solution does the speaker suggest?',
        options: ['Reducing tourism', 'Creating marine protected areas', 'Limiting fishing seasons', 'Building artificial reefs'],
        answer: 'Creating marine protected areas',
        explanation: 'Marine protected areas are mentioned as the primary solution.',
        tags: ['inference', 'solution']
      },
      {
        id: 'L5',
        stem: "The speaker's tone when discussing the future is:",
        options: ['optimistic', 'pessimistic', 'neutral', 'uncertain'],
        answer: 'cautiously optimistic',
        explanation: 'The speaker expresses hope while acknowledging challenges.',
        tags: ['inference', 'tone']
      },
      {
        id: 'L6',
        stem: 'What does the speaker say about international cooperation?',
        options: ["It's unnecessary", "It's essential", "It's difficult", "It's expensive"],
        answer: "It's essential",
        explanation: 'The speaker emphasizes the need for international cooperation.',
        tags: ['detail', 'paraphrase']
      }
    ]
  };

  const setPath = path.join(DATA_DIR, 'listening/setA.json');
  await fs.ensureDir(path.dirname(setPath));
  await fs.writeJson(setPath, sampleSet, { spaces: 2 });
}

async function createSampleWritingPrompt() {
  const samplePrompt = {
    prompt_id: 'W-A1',
    text:
      'Some people think schools should teach only job-relevant subjects, while others prefer a broad curriculum. ' +
      'Discuss both views and give your opinion (120–150 words).'
  };

  const promptPath = path.join(DATA_DIR, 'writing/promptA.json');
  await fs.ensureDir(path.dirname(promptPath));
  await fs.writeJson(promptPath, samplePrompt, { spaces: 2 });
}

export { router as apiRoutes };
