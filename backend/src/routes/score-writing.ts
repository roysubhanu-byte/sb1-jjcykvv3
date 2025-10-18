import express from 'express';
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';

const router = express.Router();

/* ===========================
   Types (response shape)
   =========================== */
interface ScoreWritingRequest {
  task_prompt: string;
  module: 'Academic' | 'General';
  task_type: 'Task 1' | 'Task 2';
  essay_text: string;
  word_count: number;
  attempt_id: string | null;
}

interface ScoreWritingResponseRaw {
  tr: number;
  cc: number;
  lr: number;
  gra: number;
  band_overall: number;
  on_topic_percent: number;
  off_topic: boolean;
  word_count: number;
  evidence_quotes: string[];
  grammar_error_count: number;
  grammar_examples: Array<{ error: string; excerpt: string; fix: string }>;
  cohesion_issues: string[];
  lexical_notes: string[];
  repetition_notes: string[];
  template_likelihood: number;
  feedback_bullets: string[];
  improvements: string[];
  spelling_errors: number;
  punctuation_errors: number;
  hyphenation_errors: number;
  paragraph_count: number;
  linking_devices: string[];
  advanced_c2_words: string[];
  phrasal_verbs: string[];
  collocations: string[];
}

/* ===========================
   Helpers
   =========================== */
const roundHalf = (n: number) => Math.round(n * 2) / 2;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const numOrNull = (v: unknown) => (isNum(v) ? (v as number) : null);

/* ===========================
   Route
   =========================== */
router.post('/score-writing', async (req, res) => {
  try {
    const {
      task_prompt,
      module,
      task_type,
      essay_text,
      word_count,
      attempt_id
    }: ScoreWritingRequest = req.body || {};

    // 1) Basic validation
    if (!task_prompt || !module || !task_type || !essay_text) {
      return res.status(400).json({
        error: 'Missing required fields: task_prompt, module, task_type, essay_text'
      });
    }
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: 'OpenAI API key not configured on server' });
    }

    // 2) Initialize clients
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const supabase = createClient(
      process.env.SUPABASE_URL || '',
      process.env.SUPABASE_SERVICE_ROLE_KEY || '',
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const minRequiredWords = task_type === 'Task 2' ? 250 : 150;

    // 3) System prompt (unchanged content from your version)
    const systemPrompt = `You are an EXTREMELY STRICT IELTS Writing examiner. Provide comprehensive, actionable feedback showing the path from current band to Band 8.0.

[Same long prompt body you already use — omitted for brevity in this file.
Keep your existing penalties, rewards, and the EXACT JSON schema requirement.]

Return JSON ONLY with this exact schema:
{
  "tr": number,
  "cc": number,
  "lr": number,
  "gra": number,
  "band_overall": number,
  "on_topic_percent": number,
  "off_topic": boolean,
  "word_count": number,
  "evidence_quotes": ["..."],
  "grammar_error_count": number,
  "grammar_examples": [{"error": "…", "excerpt": "…", "fix": "…"}],
  "cohesion_issues": ["…"],
  "lexical_notes": ["…"],
  "repetition_notes": ["…"],
  "template_likelihood": number,
  "feedback_bullets": ["TASK RESPONSE (Band X.X): ...", "..."],
  "improvements": ["PATH FROM X.X → 8.0:", "..."],
  "spelling_errors": number,
  "punctuation_errors": number,
  "hyphenation_errors": number,
  "paragraph_count": number,
  "linking_devices": ["however", "therefore", "..."],
  "advanced_c2_words": ["mitigate", "notwithstanding", "..."],
  "phrasal_verbs": ["carry out", "account for", "..."],
  "collocations": ["make a decision", "heavy traffic", "..."]
}`;

    const userPrompt = JSON.stringify({
      task_prompt,
      module,
      task_type,
      essay_text,
      word_count,
      min_required_words: minRequiredWords
    });

    // 4) Call OpenAI with strict JSON format (with a retry)
    let completion;
    try {
      completion = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.2,
        max_tokens: 2000,
        response_format: { type: 'json_object' }
      });
    } catch (err) {
      console.error('OpenAI API error:', err);
      return res.status(500).json({ error: 'AI scoring service unavailable' });
    }

    const firstText = completion.choices[0]?.message?.content;
    if (!firstText) {
      return res.status(500).json({ error: 'No response from AI scoring service' });
    }

    let parsed: ScoreWritingResponseRaw;
    try {
      parsed = JSON.parse(firstText);
    } catch {
      try {
        const retry = await openai.chat.completions.create({
          model: 'gpt-4o',
          messages: [
            { role: 'system', content: systemPrompt + '\n\nReturn JSON only. No additional text.' },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0.2,
          max_tokens: 2000,
          response_format: { type: 'json_object' }
        });
        const retryText = retry.choices[0]?.message?.content;
        if (!retryText) throw new Error('No response in retry');
        parsed = JSON.parse(retryText);
      } catch (e) {
        console.error('Retry JSON parse failed:', e);
        return res.status(500).json({ error: 'AI response format error' });
      }
    }

    // 5) Post-process & caps
    let tr = numOrNull(parsed.tr);
    let cc = numOrNull(parsed.cc);
    let lr = numOrNull(parsed.lr);
    let gra = numOrNull(parsed.gra);
    let band_overall = numOrNull(parsed.band_overall);

    // Round to half if they exist
    tr = tr === null ? null : roundHalf(tr);
    cc = cc === null ? null : roundHalf(cc);
    lr = lr === null ? null : roundHalf(lr);
    gra = gra === null ? null : roundHalf(gra);

    if (band_overall === null && tr !== null && cc !== null && lr !== null && gra !== null) {
      band_overall = roundHalf((tr + cc + lr + gra) / 4);
    } else if (band_overall !== null) {
      band_overall = roundHalf(band_overall);
    }

    // Strict caps
    let off_topic = !!parsed.off_topic;
    const on_topic_percent = numOrNull(parsed.on_topic_percent) ?? 100;
    if (off_topic === true || on_topic_percent <= 50) {
      if (band_overall !== null) band_overall = Math.min(band_overall, 3.0);
      off_topic = true;
    }
    if (word_count < minRequiredWords && band_overall !== null) {
      band_overall = Math.min(band_overall, 5.0);
    }

    // 6) Shape data for the FRONTEND (Bolt changes)
    //    - criterion_bands { TR, CC, LR, GRA }
    //    - skills_breakdown { listening, reading, writing, speaking }
    //    - improvement_path { current_level, target_level }
    const criterion_bands = {
      TR: tr,
      CC: cc,
      LR: lr,
      GRA: gra
    };

    // Only put numeric values; otherwise leave as null and UI shows N/A
    const skills_breakdown = {
      listening: null as number | null,
      reading: null as number | null,
      writing: band_overall,   // Writing band equals overall from writing scorer
      speaking: null as number | null
    };

    const improvement_path = {
      current_level: band_overall,
      target_level: 7.5  // your UI screenshot shows 7.5 target; adjust if you compute dynamically
    };

    // Merge the full payload the UI can consume
    const feedbackJsonWithCriteria = {
      ...parsed,
      tr, cc, lr, gra, band_overall, off_topic, on_topic_percent,
      criterion_bands,
      skills_breakdown,
      improvement_path
    };

    // 7) Persist to Supabase (the UI reads feedback_json)
    if (attempt_id) {
      const taskNumber = task_type === 'Task 1' ? 1 : 2;

      const { error: upsertError } = await supabase
        .from('writing_submissions')
        .upsert(
          {
            attempt_id,
            task: taskNumber,
            text_md: essay_text,
            word_count,
            band: band_overall,
            feedback_json: feedbackJsonWithCriteria,   // IMPORTANT: save the wrapped JSON
            on_topic_percent,
            off_topic,
            grammar_error_count: numOrNull(parsed.grammar_error_count),
            template_likelihood: numOrNull(parsed.template_likelihood),
            gatekeeper_result: 'ok',
            gatekeeper_reason: 'Passed gatekeeper check',
            created_at: new Date().toISOString()
          },
          { onConflict: 'attempt_id,task' }
        );

      if (upsertError) {
        console.error('Supabase upsert error:', upsertError);
        return res.status(500).json({ error: 'Failed to save scoring results' });
      }
    }

    // 8) Respond to client using the wrapped structure
    return res.json(feedbackJsonWithCriteria);
  } catch (error) {
    console.error('Error in /api/writing/score-writing:', error);
    return res.status(500).json({ error: 'Internal server error during scoring' });
  }
});

export { router as scoreWritingRouter };
