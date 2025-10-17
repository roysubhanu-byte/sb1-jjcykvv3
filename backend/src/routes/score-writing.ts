import express from 'express';
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';

const router = express.Router();

interface ScoreWritingRequest {
  task_prompt: string;
  module: 'Academic' | 'General';
  task_type: 'Task 1' | 'Task 2';
  essay_text: string;
  word_count: number;
  attempt_id: string | null;
}

interface ScoreWritingResponse {
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
  grammar_examples: Array<{
    error: string;
    excerpt: string;
    fix: string;
  }>;
  cohesion_issues: string[];
  lexical_notes: string[];
  repetition_notes: string[];
  template_likelihood: number;
  feedback_bullets: string[];
  improvements: string[];
}

router.post('/score-writing', async (req, res) => {
  try {
    const {
      task_prompt,
      module,
      task_type,
      essay_text,
      word_count,
      attempt_id
    }: ScoreWritingRequest = req.body;

    // --- validation ---
    if (!task_prompt || !module || !task_type || !essay_text) {
      return res.status(400).json({
        error: 'Missing required fields: task_prompt, module, task_type, essay_text'
      });
    }
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: 'OpenAI API key not configured on server' });
    }

    // --- clients (created inside handler) ---
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const supabase = createClient(
      process.env.SUPABASE_URL || '',
      process.env.SUPABASE_SERVICE_ROLE_KEY || '',
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const minRequiredWords = task_type === 'Task 2' ? 250 : 150;

    // --- strict examiner prompt ---
    const systemPrompt = `You are an EXTREMELY STRICT IELTS Writing examiner. Evaluate IELTS Writing using official band descriptors with ZERO tolerance.

You will receive:
- task_prompt (the exact question)
- module (Academic|General)
- task_type (Task 1|Task 2)
- essay_text
- word_count
- min_required_words

Rules:
1) Do NOT reward length beyond minimum.
2) If mostly off-topic → set off_topic=true; on_topic_percent ≤ 50; cap band_overall at 3.0.
3) If word_count < min_required_words → cap band_overall at 5.0.
4) Very weak grammar → cap 4.0. Basic vocab only → cap 5.0.
5) Repetition severe → reduce 0.5–1.0. Template opener → reduce up to 0.5 if >20%.
6) Use 0.5 increments. band_overall = avg(TR,CC,LR,GRA) then apply caps.

Return ONLY JSON:
{
  "tr": number,
  "cc": number,
  "lr": number,
  "gra": number,
  "band_overall": number,
  "on_topic_percent": number,
  "off_topic": boolean,
  "word_count": number,
  "evidence_quotes": [ "…" ],
  "grammar_error_count": number,
  "grammar_examples": [ { "error": "…", "excerpt": "…", "fix": "…" } ],
  "cohesion_issues": [ "…" ],
  "lexical_notes": [ "…" ],
  "repetition_notes": [ "…" ],
  "template_likelihood": number,
  "feedback_bullets": [ "…" ],
  "improvements": [ "…" ]
}`;

    const userPrompt = JSON.stringify({
      task_prompt,
      module,
      task_type,
      essay_text,
      word_count,
      min_required_words: minRequiredWords
    });

    // --- OpenAI call (JSON mode) ---
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
    } catch (e) {
      console.error('OpenAI API error:', e);
      return res.status(500).json({ error: 'AI scoring service unavailable' });
    }

    const responseText = completion.choices[0]?.message?.content;
    if (!responseText) {
      return res.status(500).json({ error: 'No response from AI scoring service' });
    }

    // --- parse JSON with retry fallback ---
    let scoringResult: ScoreWritingResponse;
    try {
      scoringResult = JSON.parse(responseText);
    } catch {
      const retry = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: systemPrompt + '\nReturn JSON only.' },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.2,
        max_tokens: 2000,
        response_format: { type: 'json_object' }
      });
      const retryText = retry.choices[0]?.message?.content;
      if (!retryText) return res.status(500).json({ error: 'AI response format error' });
      scoringResult = JSON.parse(retryText);
    }

    // --- post-processing & caps ---
    let { band_overall, tr, cc, lr, gra, off_topic, on_topic_percent } = scoringResult;

    if (off_topic === true || (on_topic_percent && on_topic_percent <= 50)) {
      band_overall = Math.min(band_overall, 3.0);
      off_topic = true;
    }
    if (word_count < minRequiredWords) band_overall = Math.min(band_overall, 5.0);

    // policy caps (optional)
    band_overall = Math.min(band_overall, 6.5);
    tr = Math.min(tr, 6.5);
    cc = Math.min(cc, 6.5);
    lr = Math.min(lr, 6.5);
    gra = Math.min(gra, 6.5);

    const roundHalf = (n: number) => Math.round(n * 2) / 2;
    tr = roundHalf(tr);
    cc = roundHalf(cc);
    lr = roundHalf(lr);
    gra = roundHalf(gra);
    band_overall = roundHalf(band_overall);

    const finalResult: ScoreWritingResponse = {
      ...scoringResult,
      tr,
      cc,
      lr,
      gra,
      band_overall,
      off_topic: off_topic || false,
      on_topic_percent: on_topic_percent || 100,
      word_count
    };

    // --- persist in Supabase (optional if attempt_id provided) ---
    if (attempt_id) {
      const taskNumber = task_type === 'Task 1' ? 1 : 2;
      const { error: insertError } = await supabase
        .from('writing_submissions')
        .upsert(
          {
            attempt_id,
            task: taskNumber,
            text_md: essay_text,
            word_count,
            band: finalResult.band_overall,
            feedback_json: finalResult,
            on_topic_percent: finalResult.on_topic_percent ?? null,
            off_topic: finalResult.off_topic ?? null,
            grammar_error_count: finalResult.grammar_error_count ?? null,
            template_likelihood: finalResult.template_likelihood ?? null,
            gatekeeper_result: 'ok',
            gatekeeper_reason: 'Passed gatekeeper check',
            created_at: new Date().toISOString()
          },
          { onConflict: 'attempt_id,task' }
        );
      if (insertError) {
        console.error('Supabase insert error:', insertError);
        return res.status(500).json({ error: 'Failed to save scoring results' });
      }
    }

    return res.json(finalResult);
  } catch (err) {
    console.error('Error in score-writing route:', err);
    return res.status(500).json({ error: 'Internal server error during scoring' });
  }
});

export { router as scoreWritingRouter };
