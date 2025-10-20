import express from 'express';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

const router = express.Router();

/** ---------- ENV ---------- */
const RZP_KEY_ID = process.env.RAZORPAY_KEY_ID || '';
const RZP_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || '';
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE || '';

const supabase =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE)
    : null;

function need(ok: boolean, name: string) {
  if (!ok) throw new Error(`Missing env: ${name}`);
}

/** ---------- TYPES ---------- */
type RazorpayOrder = {
  id: string;
  amount: number;   // paise
  currency: string; // 'INR'
};

/** ---------- HELPERS ---------- */
async function rzpCreateOrder(payload: Record<string, unknown>): Promise<RazorpayOrder> {
  need(!!RZP_KEY_ID, 'RAZORPAY_KEY_ID');
  need(!!RZP_KEY_SECRET, 'RAZORPAY_KEY_SECRET');
  const auth = Buffer.from(`${RZP_KEY_ID}:${RZP_KEY_SECRET}`).toString('base64');

  const res = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Razorpay order error: ${res.status} ${text}`);
  }
  return (await res.json()) as RazorpayOrder; // TS 5.6-safe
}

/** Create order */
router.post('/order', async (req, res) => {
  try {
    const {
      amountINR,
      finalPriceINR,
      brand,
      email,
      userId,
      moduleType,
      couponCode
    } = req.body ?? {};

    if (!amountINR || !brand) {
      return res.status(400).json({ error: 'amountINR and brand are required' });
    }

    const finalPrice = Number.isFinite(finalPriceINR)
      ? Number(finalPriceINR)
      : Number(amountINR);

    const payload = {
      amount: Math.round(finalPrice * 100),
      currency: 'INR',
      receipt: `${String(brand || 'TLLI').toLowerCase()}_${Date.now()}`,
      payment_capture: 1,
      notes: {
        brand: brand || '',
        email: email || '',
        user_id: userId || '',
        // your frontend sends these names:
        moduleType: moduleType || '',
        couponCode: couponCode || '',
        list_price_inr: String(amountINR),
        final_price_inr: String(finalPrice)
      }
    };

    const order = await rzpCreateOrder(payload);

    return res.json({
      id: order.id,
      amount: order.amount,
      currency: order.currency,
      finalPriceINR: finalPrice
    });
  } catch (e: any) {
    console.error('payments/order error:', e);
    return res.status(500).json({ error: e?.message || 'Failed to create order' });
  }
});

/** Verify payment (optional client-side verify) */
router.post('/verify', async (req, res) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      email,
      userId,
      moduleType
    } = req.body ?? {};

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ error: 'Invalid verification payload' });
    }

    need(!!RZP_KEY_SECRET, 'RAZORPAY_KEY_SECRET');

    const body = `${razorpay_order_id}|${razorpay_payment_id}`;
    const expectedSignature = crypto
      .createHmac('sha256', RZP_KEY_SECRET)
      .update(body)
      .digest('hex');

    if (expectedSignature !== razorpay_signature) {
      return res.status(400).json({ error: 'Signature mismatch' });
    }

    if (supabase) {
      await supabase.from('payments').insert({
        user_email: email || null,
        user_id: userId || null,
        module_type: moduleType || null,
        provider: 'razorpay',
        order_id: razorpay_order_id,
        payment_id: razorpay_payment_id,
        status: 'captured'
      });

      if (email && moduleType) {
        await supabase
          .from('user_access')
          .upsert(
            {
              user_email: email,
              module_type: moduleType,
              has_paid: true,
              source: 'razorpay_verify',
              updated_at: new Date().toISOString()
            },
            { onConflict: 'user_email,module_type' }
          );
      }
    }

    return res.json({ ok: true });
  } catch (e: any) {
    console.error('payments/verify error:', e);
    return res.status(500).json({ error: e?.message || 'Verification failed' });
  }
});

/** Direct grant-access (used by your Razorpay handler or fallback) */
router.post('/grant-access', async (req, res) => {
  try {
    const { email, moduleType, order_id, amountINR, couponCode } = req.body ?? {};

    if (!email || !moduleType) {
      return res.status(400).json({ error: 'email and moduleType are required' });
    }
    if (!supabase) {
      return res.status(500).json({ error: 'Database not configured' });
    }

    await supabase.from('payments').insert({
      user_email: email,
      module_type: moduleType,
      provider: 'razorpay',
      order_id: order_id || null,
      amount_inr: amountINR ?? null,
      coupon_code: couponCode || null,
      status: 'captured'
    });

    await supabase
      .from('user_access')
      .upsert(
        {
          user_email: email,
          module_type: moduleType,
          has_paid: true,
          source: 'grant_access_api',
          updated_at: new Date().toISOString()
        },
        { onConflict: 'user_email,module_type' }
      );

    return res.json({ ok: true });
  } catch (e: any) {
    console.error('payments/grant-access error:', e);
    return res.status(500).json({ error: e?.message || 'Grant access failed' });
  }
});

export default router;
