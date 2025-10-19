// backend/src/routes/payments.ts
import express from 'express';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

const router = express.Router();

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

async function rzpCreateOrder(payload: any) {
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
  return res.json();
}

// Create order
router.post('/order', async (req, res) => {
  try {
    const { amountINR, finalPriceINR, brand, email, userId, moduleType, couponCode } = req.body || {};
    if (!amountINR || !brand) {
      return res.status(400).json({ error: 'amountINR and brand are required' });
    }

    const finalPrice = Number.isFinite(finalPriceINR) ? Number(finalPriceINR) : Number(amountINR);

    const order = await rzpCreateOrder({
      amount: Math.round(finalPrice * 100),
      currency: 'INR',
      receipt: `${(brand || 'TLLI').toLowerCase()}_${Date.now()}`,
      payment_capture: 1,
      notes: {
        brand: brand || '',
        email: email || '',
        user_id: userId || '',
        module_type: moduleType || '',
        coupon: couponCode || '',
        list_price_inr: String(amountINR),
        final_price_inr: String(finalPrice),
      },
    });

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

// Optional verify (card/UPI in-window flows)
router.post('/verify', async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, email, userId, moduleType }_
