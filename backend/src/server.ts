// server.ts (ESM + TypeScript)
// ------------------------------------------------------------
// Keeps your existing routers and static handling.
// Adds: POST /api/attempts/:id/finish (attempt aggregator).
// Env needed: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// ------------------------------------------------------------
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

// Routers (ESM => keep .js extensions)
import apiRouter from './routes/api.js';
import { gatekeeperRouter } from './routes/gatekeeper.js';
import { scoreWritingRouter } from './routes/score-writing.js';
import { detailedScoringRouter } from './routes/detailed-scoring.js';
import speakingAsrRouter from './routes/speaking-asr.js';
import speakingScorerRouter from './routes/speaking-scorer.js';

// ------------------------------------------------------------
// Setup
// ------------------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Static (optional)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/audio',   express.static(path.join(__dirname, 'data/audio')));

// ------------------------------------------------------------
// Existing routes
// ------------------------------------------------------------
app.use('/api', apiRouter);                     // lead, listening-set, writing-prompt, attempts, report
app.use('/api/gatekeeper', gatekeeperRouter);   // POST /api/gatekeeper/check
app.use('/api/writing', scoreWritingRouter);    // POST /api/writing/score-writing
app.use('/api/writing', detailedScoringRouter); // POST /api/writing/detailed-scoring
app.use('/api/speaking', speakingAsrRouter);    // POST /api/speaking/transcribe
app.use('/api/speaking', speakingScorerRouter); // POST /api/speaking/score

// ------------------------------------------------------------
// Supabase (server-side, service role only)
// ------------------------------------------------------------
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.warn('⚠️  Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env.');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// Helpers
const roundHalf = (n: number) => Math.round(n * 2) / 2;

// ------------------------------------------------------------
// NEW: Attempt finalizer + feedback payload
// POST /api/attempts/:id/finish
// ------------------------------------------------------------
// Expects that you already write one row to `public.sections` per section
// with `type` in ('listening','reading','writing','speaking') and
// the metric columns outlined in the migration I gave you.
// This endpoint:
// 1) reads those section rows,
// 2) updates `public.attempts` with per-section bands + overall,
// 3) returns a normalized feedback payload for the Results page.
// ------------------------------------------------------------
app.post('/api/attempts/:id/finish', async (req, res) => {
  try {
    const attemptId = req.params.id;

    // 1) Fetch all section rows for this attempt
    const { data: sections, error } = await supabase
      .from('sections')
      .select('*')
      .eq('attempt_id', attemptId);

    if (error) return res.status(500).json({ error: error.message });
    if (!sections || sections.length === 0) {
      return res.status(400).json({ error: 'No sections found for attempt.' });
    }

    const byType = (t: string) => sections.find((r: any) => r.type === t) || ({} as any);

    const sListening = byType('listening');
    const sReading   = byType('reading');
    const sWriting   = byType('writing');
    const sSpeaking  = byType('speaking');

    const L = sListening.band ?? null;
    const R = sReading.band   ?? null;
    const W = sWriting.band   ?? null;
    const S = sSpeaking.band  ?? null;

    const present = [L, R, W, S].filter((x) => x !== null) as number[];
    const overall = present.length ? roundHalf(present.reduce((a, b) => a + b, 0) / present.length) : null;
    const status  = present.length === 4 ? 'completed' : 'in_progress';

    // 2) Update attempts with bands + completion markers
    const { error: upErr } = await supabase
      .from('attempts')
      .update({
        band_listening: L,
        band_reading:   R,
        band_writing:   W,
        band_speaking:  S,
        band_overall:   overall,
        finished_at:    new Date().toISOString(),
        status,
        updated_at:     new Date().toISOString(),
      })
      .eq('id', attemptId);

    if (upErr) return res.status(500).json({ error: upErr.message });

    // 3) Compose normalized feedback payload
    const feedback = {
      summary: {
        attemptId,
        status,
        bands: {
          listening: L, reading: R, writing: W, speaking: S, overall,
        },
      },
      speaking: {
        band: S,
        metrics: {
          wpm:                        sSpeaking.s_wpm ?? null,
          pause_rate:                 sSpeaking.s_pause_rate ?? null,
          self_corrections_per_min:   sSpeaking.s_self_corrections_per_min ?? null,
          connectives_unique:         sSpeaking.s_connectives_unique ?? null,
          ttr:                        sSpeaking.s_ttr ?? null,
          collocation_hits:           sSpeaking.s_collocation_hits ?? null,
          idioms:                     sSpeaking.s_idioms ?? null,
          complex_clause_pct:         sSpeaking.s_complex_clause_pct ?? null,
          error_free_clause_pct:      sSpeaking.s_error_free_clause_pct ?? null,
          stress_score:               sSpeaking.s_pron_stress_score ?? null,
          intonation_range:           sSpeaking.s_pron_intonation_range ?? null,
          segmental_flags:            sSpeaking.s_pron_segmental_flags ?? null,
        },
      },
      writing: {
        band: W,
        subbands: {
          tr:  sWriting.w_tr ?? null,
          cc:  sWriting.w_cc ?? null,
          lr:  sWriting.w_lr ?? null,
          gra: sWriting.w_gra ?? null,
        },
        metrics: {
          word_count:            sWriting.w_word_count ?? null,
          time_used_min:         sWriting.w_time_used_min ?? null,
          complex_clause_pct:    sWriting.w_complex_clause_pct ?? null,
          error_free_clause_pct: sWriting.w_error_free_clause_pct ?? null,
          linker_variety:        sWriting.w_linker_variety ?? null,
          repetition_rate:       sWriting.w_repetition_rate ?? null,
          spelling_errors:       sWriting.w_spelling_errors ?? null,
        },
      },
      listening: {
        band: L,
        accuracy_by_qtype: sListening.lr_accuracy_by_qtype ?? null,
        time_by_qtype:     sListening.lr_time_by_qtype ?? null,
        error_tags:        sListening.lr_error_tags ?? null,
      },
      reading: {
        band: R,
        accuracy_by_qtype: sReading.lr_accuracy_by_qtype ?? null,
        time_by_qtype:     sReading.lr_time_by_qtype ?? null,
        error_tags:        sReading.lr_error_tags ?? null,
      },
    };

    return res.json(feedback);
  } catch (e: any) {
    console.error('finish attempt error:', e);
    return res.status(500).json({ error: e?.message || 'Internal error' });
  }
});

// ------------------------------------------------------------
app.get('/health', (_req, res) => res.json({ ok: true }));

const PORT = Number(process.env.PORT || 8080);
app.listen(PORT, () => {
  console.log(`✅ Server listening on :${PORT}`);
});
