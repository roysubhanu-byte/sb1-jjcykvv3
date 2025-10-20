import express from 'express';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

const router = express.Router();

// ----- ENV -----
const RZP_KEY_ID = process.env.RAZORPAY_KEY_ID || '';
const RZP_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || '';
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE || '';

const supabase =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE)
    : null;

function requireEnv(ok: boolean, name: string) {
  if (!ok) throw new Error(`Missing env: ${name}`);
}

// Razorpay order type we care about
type RzpOrder = { id: string; amount: number; currency: string };

// ----- Helpers -----
async function rzpCreateOrder(payload: any): Promise<RzpOrder> {
  requireEnv(!!RZP_KEY_ID, 'RAZORPAY_KEY_ID');
  requireEnv(!!RZP_KEY_SECRET, 'RAZORPAY_KEY_SECRET');

  const auth = Buffer.from(`${RZP_KEY_ID}:${RZP_KEY_SECRET}`).toString('base64');

  const res = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Razorpay order error: ${res.status} ${text}`);
  }

  // Cast to our minimal shape to avoid TS “unknown”
  return (await res.json()) as RzpOrder;
}

/**
 * POST /payments/order
 * body: { amountINR, finalPriceINR?, brand, email?, userId?, moduleType?, couponCode? }
 */
router.post('/order', async (req, res) => {
  try {
    const {
      amountINR,
      finalPriceINR,
      brand,
      email,
      userId,
      moduleType,
      couponCode,
    } = req.body || {};

    if (!amountINR || !brand) {
      return res.status(400).json({ error: 'amountINR and brand are required' });
    }

    const finalPrice = Number.isFinite(finalPriceINR) ? Number(finalPriceINR) : Number(amountINR);

    const payload = {
      amount: Math.round(finalPrice * 100), // paise
      currency: 'INR',
      receipt: `${(brand || 'TLLI').toLowerCase()}_${Date.now()}`,
      payment_capture: 1,
      notes: {
        // keep both to be tolerant of old/new frontends
        moduleType: moduleType || '',
        couponCode: couponCode || '',
        brand: brand || '',
        email: email || '',
        user_id: userId || '',
        list_price_inr: String(amountINR),
        final_price_inr: String(finalPrice),
      },
    };

    const order = await rzpCreateOrder(payload);

    return res.json({
      id: order.id,
      amount: order.amount,
      currency: order.currency,
      finalPriceINR: finalPrice,
    });
  } catch (e: any) {
    console.error('payments/order error:', e);
    return res.status(500).json({ error: e?.message || 'Failed to create order' });
  }
});

/**
 * POST /payments/grant-access
 * body: { email, moduleType, order_id?, amountINR?, couponCode? }
 * (Used by the client handler to grant access immediately.)
 */
router.post('/grant-access', async (req, res) => {
  try {
    const { email, moduleType, order_id, amountINR, couponCode } = req.body || {};
    if (!email || !moduleType) {
      return res.status(400).json({ error: 'email and moduleType are required' });
    }
    if (!supabase) return res.status(500).json({ error: 'Database not configured' });

    await supabase.from('payments').insert({
      user_email: email,
      module_type: moduleType,
      provider: 'razorpay',
      order_id: order_id || null,
      amount_inr: amountINR ?? null,
      coupon_code: couponCode || null,
      status: 'captured',
    });

    await supabase
      .from('user_access')
      .upsert(
        {
          user_email: email,
          module_type: moduleType,
          has_paid: true,
          source: 'grant_access_api',
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_email,module_type' }
      );

    return res.json({ ok: true });
  } catch (e: any) {
    console.error('payments/grant-access error:', e);
    return res.status(500).json({ error: e?.message || 'Grant access failed' });
  }
});

/**
 * (Alias) GET /payments/status
 * (New)   GET /payments/verify-access   <-- this is what your frontend is polling
 * Query: ?email=...&moduleType=...
 * Returns: { hasPaid: boolean }
 */
async function readAccess(email: string, moduleType: string): Promise<boolean> {
  if (!supabase) return false;
  const { data, error } = await supabase
    .from('user_access')
    .select('has_paid')
    .eq('user_email', email)
    .eq('module_type', moduleType)
    .maybeSingle();
  if (error) {
    console.warn('readAccess error:', error);
    return false;
  }
  return Boolean(data?.has_paid);
}

router.get('/verify-access', async (req, res) => {
  try {
    const email = String(req.query.email || '');
    const moduleType = String(req.query.moduleType || '');
    if (!email || !moduleType) return res.status(400).json({ hasPaid: false });

    const hasPaid = await readAccess(email, moduleType);
    return res.status(200).json({ hasPaid });
  } catch {
    return res.status(200).json({ hasPaid: false });
  }
});

router.get('/status', async (req, res) => {
  try {
    const email = String(req.query.email || '');
    const moduleType = String(req.query.moduleType || '');
    if (!email || !moduleType) return res.status(400).json({ hasPaid: false });

    const hasPaid = await readAccess(email, moduleType);
    return res.status(200).json({ hasPaid });
  } catch {
    return res.status(200).json({ hasPaid: false });
  }
});

export default router;
