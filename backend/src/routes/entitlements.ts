import express from 'express';
import { createClient } from '@supabase/supabase-js';

const router = express.Router();

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE || '';
const supabase = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
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
  } catch (e:any) {
    return res.status(500).json({ error: e?.message || 'failed' });
  }
});

export default router;
