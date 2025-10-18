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

const roundHalf = (n: number) => Math.round(n * 2) / 2;
const numOrNull = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

router.post('/score-writing', async (req, res) => {
  try {
    const { task_prompt, module, task_type, essay_text, word_count, attempt_id }: ScoreWritingRequest = req.body || {};
    if (!task_prompt || !module || !task_type || !essay_text) {
      return res.status(400).json({ error: 'Missing required fields: task_prompt, module, task_type, essay_text' });
    }
    if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: 'OpenAI API key not configured on server' });

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const supabase = createClient(process.env.SUPABASE_URL || '', process.env.SUPABASE_SERVICE_ROLE_KEY || '', {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    const minRequiredWords = task_type === 'Task 2' ? 250 : 150;

    const systemPrompt = `You are an EXTREMELY STRICT IELTS Writing examiner. Return JSON ONLY with keys:
tr, cc, lr, gra, band_overall, on_topic_percent, off_topic, word_count,
evidence_quotes, grammar_error_count, grammar_examples, cohesion_issues,
lexical_notes, repetition_notes, template_likelihood, feedback_bullets, improvements,
spelling_errors, punctuation_errors, hyphenation_errors, paragraph_count,
linking_devices, advanced_c2_words, phrasal_verbs, collocations.`;

    const userPrompt = JSON.stringify({ task_prompt, module, task_type, essay_text, word_count, min_required_words: minRequiredWords });

    // call with retry
    const call = async () => openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
      temperature: 0.2,
      max_tokens: 2000,
      response_format: { type: 'json_object' }
    });
    let raw = await call();
    let text = raw.choices[0]?.message?.content;
    if (!text) { raw = await call(); text = raw.choices[0]?.message?.content; }
    if (!text) return res.status(500).json({ error: 'AI scoring service unavailable' });

    let p: any;
    try { p = JSON.parse(text); } catch { raw = await call(); text = raw.choices[0]?.message?.content; p = JSON.parse(text || '{}'); }

    // numbers
    let tr = numOrNull(p.tr); let cc = numOrNull(p.cc); let lr = numOrNull(p.lr); let gra = numOrNull(p.gra);
    tr = tr === null ? null : roundHalf(tr);
    cc = cc === null ? null : roundHalf(cc);
    lr = lr === null ? null : roundHalf(lr);
    gra = gra === null ? null : roundHalf(gra);

    let band_overall = numOrNull(p.band_overall);
    if (band_overall === null && tr !== null && cc !== null && lr !== null && gra !== null) {
      band_overall = roundHalf((tr + cc + lr + gra) / 4);
    } else if (band_overall !== null) band_overall = roundHalf(band_overall);

    let off_topic = !!p.off_topic;
    const on_topic_percent = numOrNull(p.on_topic_percent) ?? 100;
    if (off_topic || on_topic_percent <= 50) {
      if (band_overall !== null) band_overall = Math.min(band_overall, 3.0);
      off_topic = true;
    }
    if (word_count < minRequiredWords && band_overall !== null) band_overall = Math.min(band_overall, 5.0);

    // ==== shape for frontend ====
    const criterion_bands = { TR: tr, CC: cc, LR: lr, GRA: gra };
    const skills_breakdown = { listening: null, reading: null, writing: band_overall, speaking: null };
    const improvement_path = { current_level: band_overall, target_level: 7.5 };

    const overall_feedback =
      Array.isArray(p.feedback_bullets) && p.feedback_bullets.length
        ? p.feedback_bullets.join('\n')
        : (typeof p.feedback === 'string' ? p.feedback : '');

    const writing_analysis = {
      overall_feedback: overall_feedback || 'No feedback available.',
      improvement_actions: Array.isArray(p.improvements) && p.improvements.length ? p.improvements : (Array.isArray(p.actions) ? p.actions : [])
    };

    const feedback_json = {
      ...p,
      tr, cc, lr, gra, band_overall, off_topic, on_topic_percent,
      criterion_bands, skills_breakdown, improvement_path,
      writing_analysis
    };

    if (attempt_id) {
      const taskNumber = task_type === 'Task 1' ? 1 : 2;
      const { error } = await supabase
        .from('writing_submissions')
        .upsert(
          {
            attempt_id,
            task: taskNumber,
            text_md: essay_text,
            word_count,
            band: band_overall,
            feedback_json,
            on_topic_percent,
            off_topic,
            grammar_error_count: numOrNull(p.grammar_error_count),
            template_likelihood: numOrNull(p.template_likelihood),
            gatekeeper_result: 'ok',
            gatekeeper_reason: 'Passed gatekeeper check',
            created_at: new Date().toISOString()
          },
          { onConflict: 'attempt_id,task' }
        );
      if (error) return res.status(500).json({ error: 'Failed to save scoring results' });
    }

    return res.json(feedback_json);
  } catch (e) {
    console.error('Error in /api/writing/score-writing:', e);
    return res.status(500).json({ error: 'Internal server error during scoring' });
  }
});

export { router as scoreWritingRouter };
