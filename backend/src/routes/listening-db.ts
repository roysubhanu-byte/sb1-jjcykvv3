import express from 'express';
import { createClient } from '@supabase/supabase-js';

export const listeningDbRouter = express.Router();

/**
 * Returns a free listening set from Supabase items
 * Env:
 *  - FREE_LISTENING_FORM_ID (default: FORM_A1)
 *  - FREE_LISTENING_Q_START (default: 11)
 *  - FREE_LISTENING_Q_END   (default: 20)
 */
listeningDbRouter.get('/listening-set', async (_req, res) => {
  try {
    const formId = (process.env.FREE_LISTENING_FORM_ID || 'FORM_A1').trim();
    const qStart = Number(process.env.FREE_LISTENING_Q_START || 11);
    const qEnd   = Number(process.env.FREE_LISTENING_Q_END   || 20);

    const supabase = createClient(
      process.env.SUPABASE_URL || '',
      process.env.SUPABASE_SERVICE_ROLE_KEY || '',
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Your schema columns:
    // item_id, module, section, form_id, passage_id,
    // question_no, item_type, stem, options_json, correct_answer,
    // audio_url, image_url, explanation, tags, difficulty
    const { data: items, error } = await supabase
      .from('items')
      .select('question_no, stem, options_json, correct_answer, explanation, audio_url, section, form_id')
      .eq('form_id', formId)
      .eq('section', 'Listening')
      .gte('question_no', qStart)
      .lte('question_no', qEnd)
      .order('question_no', { ascending: true });

    if (error) return res.status(500).json({ error: 'Failed to load items' });
    if (!items?.length) return res.status(404).json({ error: 'No items for the chosen range' });

    const set = {
      set_id: `${formId}-Q${qStart}-${qEnd}`,
      audio_url: items[0]?.audio_url || '',
      items: items.map(it => ({
        id: `L${it.question_no}`,
        stem: it.stem,
        options: Array.isArray(it.options_json)
          ? it.options_json
          : JSON.parse(it.options_json || '[]'),
        answer: it.correct_answer,
        explanation: it.explanation || '',
        tags: [],
        paraphrases: []
      }))
    };

    return res.json(set);
  } catch (e:any) {
    console.error('listening-set error', e);
    return res.status(500).json({ error: 'Server error loading listening set' });
  }
});
