import express from 'express';
import { createClient } from '@supabase/supabase-js';

const router = express.Router();

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE || '';
const supabase =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    : null;

/** GET /api/attempts/remaining?email=...&moduleType=Academic|General */
router.get('/attempts/remaining', async (req, res) => {
  try {
    const email = String(req.query.email || '').trim().toLowerCase();
    const moduleType = String(req.query.moduleType || '').trim();
    if (!email || !moduleType) return res.status(400).json({ error: 'bad request' });
    if (!supabase) return res.status(500).json({ error: 'db not configured' });

    const { data, error } = await supabase
      .from('user_entitlements')
      .select('remaining')
      .eq('user_email', email)
      .eq('module_type', moduleType)
      .maybeSingle();

    if (error) return res.status(500).json({ error: 'query failed' });
    return res.json({ remaining: data?.remaining ?? 0 });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'failed' });
  }
});

/**
 * POST /api/attempts/start
 * body: { email, moduleType }
 *
 * Consumes ONE attempt atomically from user_entitlements.
 * Returns: { ok: true, remaining: number } or { error: 'NO_ATTEMPTS' }
 */
router.post('/attempts/start', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const moduleType = String(req.body?.moduleType || '').trim();
    if (!email || !moduleType) return res.status(400).json({ error: 'bad request' });
    if (!supabase) return res.status(500).json({ error: 'db not configured' });

    // 1) Read current remaining
    const { data: ent, error: qErr } = await supabase
      .from('user_entitlements')
      .select('remaining')
      .eq('user_email', email)
      .eq('module_type', moduleType)
      .maybeSingle();

    if (qErr) return res.status(500).json({ error: 'query failed' });

    const remaining = Number(ent?.remaining ?? 0);
    if (!remaining || remaining <= 0) {
      return res.status(400).json({ error: 'NO_ATTEMPTS' });
    }

    // 2) Decrement by 1 (uses your existing RPC: increment_entitlement(p_email, p_module, p_add))
    const { data: dec, error: rpcErr } = await supabase.rpc('increment_entitlement', {
      p_email: email,
      p_module: moduleType,
      p_add: -1,
    });

    if (rpcErr) return res.status(500).json({ error: 'decrement failed' });

    // If your RPC returns the new remaining, prefer that; else compute remaining - 1
    const newRemaining =
      typeof dec === 'number'
        ? dec
        : Math.max(0, remaining - 1);

    return res.json({ ok: true, remaining: newRemaining });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'failed' });
  }
});

export default router;
