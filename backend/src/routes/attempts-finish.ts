import express from 'express';
import { createClient } from '@supabase/supabase-js';

export const attemptsFinishRouter = express.Router();

type Band = number | null;

function roundIELTS(x: number): number {
  const floor = Math.floor(x);
  const frac = x - floor;
  if (frac < 0.25) return floor;
  if (frac < 0.75) return floor + 0.5;
  return floor + 1;
}

function meanHalf(vals: (number | null | undefined)[]): number | null {
  const nums = vals.filter((v): v is number => typeof v === 'number' && !Number.isNaN(v));
  if (!nums.length) return null;
  return roundIELTS(nums.reduce((a, b) => a + b, 0) / nums.length);
}

attemptsFinishRouter.post('/attempts/:id/finish', async (req, res) => {
  try {
    const attemptId = req.params.id;

    const supabase = createClient(
      process.env.SUPABASE_URL || '',
      process.env.SUPABASE_SERVICE_ROLE_KEY || '',
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // 1) Attempt exists?
    const { data: attempt, error: attemptErr } = await supabase
      .from('attempts')
      .select('*')
      .eq('id', attemptId)
      .single();

    if (attemptErr || !attempt) {
      return res.status(404).json({ error: 'Attempt not found' });
    }

    // 2) Sections (use sections.name)
    const { data: sections, error: secErr } = await supabase
      .from('sections')
      .select('name, band, ai_json, completed_at, updated_at')
      .eq('attempt_id', attemptId);

    if (secErr) return res.status(500).json({ error: 'Failed to read sections' });

    const getByName = (n: string) =>
      sections?.find(r => (r.name || '').toLowerCase() === n.toLowerCase()) || null;

    const listeningRow = getByName('Listening');
    const readingRow   = getByName('Reading');
    const writingRow   = getByName('Writing');   // optional, bands derived from writing_submissions
    const speakingRowS = getByName('Speaking');  // optional, bands may come from speaking_attempts

    const bandListening: Band = listeningRow?.band ?? null;
    const bandReading:   Band = readingRow?.band ?? null;

    // 3) Writing (avg Task 1 & 2)
    const { data: writingSubs, error: wsErr } = await supabase
      .from('writing_submissions')
      .select('task, band, feedback_json')
      .eq('attempt_id', attemptId);

    if (wsErr) return res.status(500).json({ error: 'Failed to read writing_submissions' });

    let writingBands: number[] = [];
    let writing_task1_data: any = null;
    let writing_task2_data: any = null;

    (writingSubs || []).forEach(row => {
      if (typeof row.band === 'number') writingBands.push(row.band);
      if (row.task === 1) writing_task1_data = row.feedback_json || null;
      if (row.task === 2) writing_task2_data = row.feedback_json || null;
    });

    const bandWriting: Band = writingBands.length
      ? roundIELTS(writingBands.reduce((a, b) => a + b, 0) / writingBands.length)
      : null;

    // 4) Speaking (speaking_attempts table)
    const { data: speakingRows, error: spErr } = await supabase
      .from('speaking_attempts')
      .select('band, feedback_json, created_at')
      .eq('attempt_id', attemptId)
      .order('created_at', { ascending: false })
      .limit(1);

    if (spErr) return res.status(500).json({ error: 'Failed to read speaking attempts' });

    const speakingRow = speakingRows?.[0] || null;
    const bandSpeaking: Band = typeof speakingRow?.band === 'number'
      ? roundIELTS(speakingRow.band) : null;

    // 5) Overall
    const bandOverall: Band = meanHalf([bandListening, bandReading, bandWriting, bandSpeaking]);

    // 6) Update attempts
    const { error: updErr } = await supabase
      .from('attempts')
      .update({
        band_listening: bandListening,
        band_reading:   bandReading,
        band_writing:   bandWriting,
        band_speaking:  bandSpeaking,
        band_overall:   bandOverall,
        status:         'completed',
        finished_at:    new Date().toISOString(),
        updated_at:     new Date().toISOString()
      })
      .eq('id', attemptId);

    if (updErr) return res.status(500).json({ error: 'Failed to update attempt' });

    // 7) Build reviews for UI (pull from sections.ai_json if present)
    const listening_review = listeningRow?.ai_json?.review || { wrong: [], synonyms_suggested: [] };
    const reading_review   = readingRow?.ai_json?.review   || { wrong: [], synonyms_suggested: [] };

    const writing_review = {
      feedback: 'See detailed Task 1 & Task 2 feedback.',
      actions: [],
      tr: writing_task2_data?.tr ?? writing_task1_data?.tr ?? 'N/A',
      cc: writing_task2_data?.cc ?? writing_task1_data?.cc ?? 'N/A',
      lr: writing_task2_data?.lr ?? writing_task1_data?.lr ?? 'N/A',
      gra: writing_task2_data?.gra ?? writing_task1_data?.gra ?? 'N/A',
      band_overall: bandWriting ?? 'N/A'
    };

    const speaking_review = speakingRow?.feedback_json || {
      overall: bandSpeaking ?? 'N/A',
      bands: { fluency: null, lexical: null, grammar: null, pronunciation: null },
      feedback_bullets: [],
      improvements: []
    };

    return res.json({
      attempt_id: attemptId,
      bands: {
        listening: bandListening ?? 'N/A',
        reading:   bandReading   ?? 'N/A',
        writing:   bandWriting   ?? 'N/A',
        speaking:  bandSpeaking  ?? 'N/A',
        overall:   bandOverall   ?? 'N/A'
      },
      listening_review,
      reading_review,
      writing_review,
      writing_task1_data,
      writing_task2_data,
      speaking_review,
      plan7d: [] // keep for compatibility; UI may ignore
    });
  } catch (e:any) {
    console.error('finish endpoint error', e);
    return res.status(500).json({ error: 'Server error finishing attempt' });
  }
});
