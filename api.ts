import express from 'express';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs-extra';
import { v4 as uuidv4 } from 'uuid';
import { scoreWriting } from '../utils/scoreWriting';
import { sendEmailReport } from '../utils/emailService';
import { generatePdfReport } from '../utils/pdfService';

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
router.get('/listening-set', async (req, res) => {
  try {
    const setPath = path.join(DATA_DIR, 'listening/setA.json');
    
    // Check if file exists, create sample if not
    if (!await fs.pathExists(setPath)) {
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
router.get('/writing-prompt', async (req, res) => {
  try {
    const promptPath = path.join(DATA_DIR, 'writing/promptA.json');
    
    // Check if file exists, create sample if not
    if (!await fs.pathExists(promptPath)) {
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
    
    // Compute listening band (0-1 → 4.5; 2-3 → 5.5; 4-5 → 6.5; 6 → 7.5)
    const listeningBand = computeListeningBand(listening.raw);
    
    // Load listening set to get wrong question details
    const setPath = path.join(DATA_DIR, 'listening/setA.json');
    const listeningSet = await fs.readJson(setPath);
    
    // Analyze wrong answers
    const listeningReview = analyzeListeningErrors(listening.wrong_ids, listeningSet);
    
    // Score writing with AI
    const writingReview = await scoreWriting(writing.text);
    
    // Calculate overall band
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
    
    if (!await fs.pathExists(attemptPath)) {
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

// Helper functions
function computeListeningBand(rawScore: number): number {
  if (rawScore <= 1) return 4.5;
  if (rawScore <= 3) return 5.5;
  if (rawScore <= 5) return 6.5;
  return 7.5;
}

function analyzeListeningErrors(wrongIds: string[], listeningSet: any) {
  const tagCounts: Record<string, number> = {};
  const wrongItems: any[] = [];
  
  wrongIds.forEach(id => {
    const item = listeningSet.items.find((i: any) => i.id === id);
    if (item) {
      wrongItems.push({
        id: item.id,
        explanation: item.explanation,
        paraphrases: item.paraphrases
      });
      
      // Count tags
      item.tags.forEach((tag: string) => {
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      });
    }
  });
  
  // Get top 2 weak areas
  const sortedTags = Object.entries(tagCounts)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 2);
  
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
  
  return {
    wrong: wrongItems,
    synonyms_suggested: synonymsSuggested
  };
}

function generate7DayPlan(listeningBand: number, writingBand: number, listeningReview: any, writingReview: any): string[] {
  const plan = [];
  const overallBand = (listeningBand + writingBand) / 2;
  
  // Identify specific weaknesses from feedback
  const weaknesses = [];
  const strengths = [];
  
  // Analyze listening weaknesses
  if (listeningBand < 5.0) {
    weaknesses.push('basic listening comprehension');
  } else if (listeningBand < 6.0) {
    weaknesses.push('academic listening skills');
  }
  
  // Analyze writing weaknesses from detailed feedback
  if (writingReview.tr && writingReview.tr < 5.0) weaknesses.push('task response and addressing the prompt');
  if (writingReview.cc && writingReview.cc < 5.0) weaknesses.push('essay organization and coherence');
  if (writingReview.lr && writingReview.lr < 5.0) weaknesses.push('vocabulary range and accuracy');
  if (writingReview.gra && writingReview.gra < 5.0) weaknesses.push('grammar and sentence structure');
  
  if (writingReview.off_topic) weaknesses.push('staying on topic and addressing all parts of the question');
  if (writingReview.template_likelihood && writingReview.template_likelihood > 0.5) weaknesses.push('using original language instead of memorized phrases');
  if (writingReview.grammar_error_count && writingReview.grammar_error_count > 3) weaknesses.push('grammar accuracy');
  
  // Identify strengths
  if (listeningBand >= 6.0) strengths.push('listening comprehension');
  if (writingBand >= 6.0) strengths.push('writing skills');
  
  // Day 1 - Detailed assessment with specific weaknesses
  let day1 = `Day 1: Analyze your results - Listening: ${listeningBand}, Writing: ${writingBand}, Overall: ${overallBand.toFixed(1)}. `;
  if (weaknesses.length > 0) {
    day1 += `Priority weaknesses: ${weaknesses.slice(0, 3).join(', ')}. `;
  }
  if (strengths.length > 0) {
    day1 += `Maintain your ${strengths.join(' and ')}.`;
  }
  plan.push(day1);
  
  // Day 2 - Targeted listening practice based on specific weaknesses
  if (listeningBand < 4.0) {
    plan.push('Day 2: Basic listening foundation - Watch English videos with subtitles for 30 minutes. Focus on understanding main ideas in familiar topics like daily conversations.');
  } else if (listeningBand < 5.0) {
    plan.push('Day 2: IELTS Listening Part 1 intensive practice - Complete 3 practice sets focusing on everyday conversations. Practice note-taking while listening.');
  } else if (listeningBand < 6.0) {
    plan.push('Day 2: IELTS Listening Parts 2-3 focus - Practice academic contexts and social situations. Work on identifying paraphrases and synonyms.');
  } else if (listeningBand < 7.0) {
    plan.push('Day 2: Advanced listening skills - Practice IELTS Part 4 academic lectures. Focus on understanding complex arguments and detailed information.');
  } else {
    plan.push('Day 2: Maintain listening excellence - Practice with authentic academic content like university lectures and research presentations.');
  }
  
  // Day 3 - Targeted writing practice based on specific criteria weaknesses
  if (writingBand < 4.0) {
    plan.push('Day 3: Writing fundamentals - Practice basic sentence structure for 45 minutes. Write 5 simple but grammatically correct sentences about familiar topics.');
  } else if (writingBand < 5.0) {
    plan.push('Day 3: Essay structure mastery - Practice writing clear introductions, body paragraphs with examples, and conclusions. Write one 200-word practice essay.');
  } else if (writingBand < 6.0) {
    plan.push('Day 3: Paragraph development - Practice writing well-developed body paragraphs with clear topic sentences, examples, and explanations. Focus on vocabulary variety.');
  } else if (writingBand < 7.0) {
    plan.push('Day 3: Advanced argumentation - Practice presenting balanced arguments with sophisticated reasoning. Use complex grammatical structures accurately.');
  } else {
    plan.push('Day 3: Writing refinement - Focus on nuanced arguments, sophisticated language, and flawless execution of complex ideas.');
  }
  
  // Day 4 - Address most critical weakness identified in feedback
  let day4 = 'Day 4: ';
  if (writingReview.off_topic) {
    day4 += 'Topic focus training - Practice reading questions carefully and planning essays that directly address all parts of the prompt. Complete 3 essay planning exercises.';
  } else if (writingReview.template_likelihood && writingReview.template_likelihood > 0.5) {
    day4 += 'Original language development - Practice expressing ideas in your own words. Avoid memorized phrases. Write 3 short paragraphs using only original expressions.';
  } else if (writingReview.grammar_error_count && writingReview.grammar_error_count > 3) {
    day4 += 'Grammar accuracy focus - Review and practice the specific grammar points identified in your feedback. Complete targeted grammar exercises.';
  } else if (writingReview?.actions && writingReview.actions.length > 0) {
    day4 += `${writingReview.actions[0]} - Complete specific exercises targeting this weakness.`;
  } else if (listeningReview?.synonyms_suggested && listeningReview.synonyms_suggested.length > 0) {
    day4 += `${listeningReview.synonyms_suggested[0]} Practice synonym recognition exercises.`;
  } else {
    day4 += 'Vocabulary and grammar reinforcement - Complete 30 minutes of targeted vocabulary building and grammar review exercises.';
  }
  plan.push(day4);
  
  // Day 5 - Strategic practice test based on weakness pattern
  if (listeningBand < writingBand - 1.0) {
    plan.push('Day 5: Listening-focused practice test - Complete a full listening practice test under timed conditions. Analyze every wrong answer to understand patterns.');
  } else if (writingBand < listeningBand - 1.0) {
    plan.push('Day 5: Writing-intensive practice - Complete both Task 1 and Task 2 under timed conditions (60 minutes total). Focus on your identified weaknesses.');
  } else {
    plan.push('Day 5: Balanced practice test - Complete both listening and writing sections under exam conditions. Time yourself strictly and review all mistakes.');
  }
  
  // Day 6 - Advanced strategies based on performance level
  if (overallBand < 5.0) {
    plan.push('Day 6: Essential exam strategies - Master basic time management (20 min Task 1, 40 min Task 2). Learn to identify question types quickly. Practice elimination techniques for listening.');
  } else if (overallBand < 6.0) {
    plan.push('Day 6: Intermediate strategies - Practice advanced note-taking during listening. Learn to identify paraphrases quickly. Master essay planning in 5 minutes.');
  } else {
    plan.push('Day 6: Advanced exam techniques - Practice prediction skills for listening. Master complex essay structures. Work on sophisticated vocabulary usage.');
  }
  
  // Day 7 - Consolidation and next steps based on specific needs
  if (overallBand < 6.0) {
    plan.push('Day 7: Comprehensive review - Revisit your weakest areas from Days 1-6. Take a mini-test focusing on your problem areas. Consider additional English foundation work.');
  } else if (overallBand < 7.0) {
    plan.push('Day 7: Progress assessment - Take another diagnostic test to measure improvement. Adjust your study plan based on remaining weaknesses.');
  } else {
    plan.push('Day 7: Excellence maintenance - Take a full practice test to maintain your high level. Focus on consistency and exam-day strategies.');
  }
  
  return plan;
}

// Create sample data if not exists
async function createSampleListeningSet() {
  const sampleSet = {
    "set_id": "LS-A1",
    "audio_url": "/audio/lecture01.mp3",
    "items": [
      {
        "id": "L1",
        "stem": "What is the lecture mainly about?",
        "options": ["Pollution metrics", "Marine biodiversity impacts", "Fishing quotas", "Tourism trends"],
        "answer": "Marine biodiversity impacts",
        "explanation": "Focus is on biodiversity effects.",
        "tags": ["inference", "main-idea"],
        "paraphrases": ["marine life", "species diversity", "ecosystem impact"]
      },
      {
        "id": "L2",
        "stem": "According to the speaker, the decline is primarily due to…",
        "options": ["coastal construction", "overfishing", "temperature rise", "noise pollution"],
        "answer": "temperature rise",
        "explanation": "They cite warming waters.",
        "tags": ["detail", "paraphrase"]
      },
      {
        "id": "L3",
        "stem": "The speaker mentions that coral reefs support what percentage of marine species?",
        "options": ["15%", "25%", "35%", "45%"],
        "answer": "25%",
        "explanation": "The speaker states 25% of marine species depend on coral reefs.",
        "tags": ["numbers", "detail"]
      },
      {
        "id": "L4",
        "stem": "What solution does the speaker suggest?",
        "options": ["Reducing tourism", "Creating marine protected areas", "Limiting fishing seasons", "Building artificial reefs"],
        "answer": "Creating marine protected areas",
        "explanation": "Marine protected areas are mentioned as the primary solution.",
        "tags": ["inference", "solution"]
      },
      {
        "id": "L5",
        "stem": "The speaker's tone when discussing the future is:",
        "options": ["optimistic", "pessimistic", "neutral", "uncertain"],
        "answer": "cautiously optimistic",
        "explanation": "The speaker expresses hope while acknowledging challenges.",
        "tags": ["inference", "tone"]
      },
      {
        "id": "L6",
        "stem": "What does the speaker say about international cooperation?",
        "options": ["It's unnecessary", "It's essential", "It's difficult", "It's expensive"],
        "answer": "It's essential",
        "explanation": "The speaker emphasizes the need for international cooperation.",
        "tags": ["detail", "paraphrase"]
      }
    ]
  };

  const setPath = path.join(DATA_DIR, 'listening/setA.json');
  await fs.ensureDir(path.dirname(setPath));
  await fs.writeJson(setPath, sampleSet, { spaces: 2 });
}

async function createSampleWritingPrompt() {
  const samplePrompt = {
    "prompt_id": "W-A1",
    "text": "Some people think schools should teach only job-relevant subjects, while others prefer a broad curriculum. Discuss both views and give your opinion (120–150 words)."
  };

  const promptPath = path.join(DATA_DIR, 'writing/promptA.json');
  await fs.ensureDir(path.dirname(promptPath));
  await fs.writeJson(promptPath, samplePrompt, { spaces: 2 });
}

export { router as apiRoutes };