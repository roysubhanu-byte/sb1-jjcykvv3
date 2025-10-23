// src/routes/entitlements.ts
import express from 'express';
import { createClient } from '@supabase/supabase-js';

const router = express.Router();

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE || '';

const supabase =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
    : null;

/**
 * GET /api/attempts/remaining?email=...&moduleType=Academic|General
 * Returns { remaining: number }
 */
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
 * Body: { email: string, moduleType: 'Academic'|'General' }
 * Atomically consumes ONE attempt. Returns { ok: true, remaining: number }
 *
 * NOTE: This calls a Postgres RPC function `consume_attempt(p_email text, p_module text)`
 * which must:
 *   - create an entitlement row if missing (remaining = 0 by default)
 *   - if remaining > 0 then remaining = remaining - 1 and return the new remaining
 *   - perform the decrement atomically (in a transaction)
 */
router.post('/attempts/start', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const moduleType = String(req.body?.moduleType || '').trim();

    if (!email || !moduleType) return res.status(400).json({ error: 'bad request' });
    if (!supabase) return res.status(500).json({ error: 'db not configured' });

    // Call your SQL function for atomic decrement
    const { data, error } = await supabase.rpc('consume_attempt', {
      p_email: email,
      p_module: moduleType,
    });

    if (error) {
      // If the function doesn't exist or throws, surface a clear message
      if ((error as any)?.code === '42883') {
        // undefined_function
        return res.status(500).json({
          error:
            'RPC consume_attempt not found. Create it in your database before using this route.',
        });
      }
      // Custom error raised by function when no attempts left
      const msg = (error as any)?.message || '';
      if (msg.includes('NO_ATTEMPTS')) {
        return res.status(400).json({ error: 'NO_ATTEMPTS' });
      }
      return res.status(500).json({ error: 'consume failed' });
    }

    // Expecting the function to return { remaining: number }
    const remaining =
      typeof data === 'object' && data !== null && 'remaining' in data
        ? (data as any).remaining
        : Number(data);

    return res.json({ ok: true, remaining: Number.isFinite(remaining) ? remaining : 0 });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'failed' });
  }
});

export default router;
