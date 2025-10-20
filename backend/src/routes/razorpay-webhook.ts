// src/routes/razorpay-webhook.ts
import type { Request, Response } from 'express';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE || '';

const supabase =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE) : null;

const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || '';

export async function webhookRawHandler(req: Request, res: Response) {
  try {
    if (!WEBHOOK_SECRET) {
      return res.status(500).send('Missing RAZORPAY_WEBHOOK_SECRET');
    }

    // Razorpay sends body as raw buffer; signature in header
    const payload = (req.body as Buffer).toString('utf8');
    const signature = req.header('x-razorpay-signature') || '';

    const expected = crypto.createHmac('sha256', WEBHOOK_SECRET).update(payload).digest('hex');
    if (expected !== signature) {
      return res.status(400).send('Invalid signature');
    }

    const event = JSON.parse(payload);
    if (event.event !== 'payment.captured') {
      return res.json({ ok: true, ignored: true });
    }

    const payment = event.payload?.payment?.entity;
    const notes = (payment?.notes || {}) as Record<string, any>;

    // We read camelCase keys to match your frontend
    const email = notes.email || '';
    const moduleType = notes.moduleType || '';
    const couponCode = notes.couponCode || '';
    const orderId = payment?.order_id || null;
    const amountInPaise = Number(payment?.amount || 0);
    const amountInr = amountInPaise ? amountInPaise / 100 : null;

    if (!email || !moduleType || !supabase) {
      // Nothing to do, but don't fail the webhook (idempotency)
      return res.json({ ok: true, missing: { email: !!email, moduleType: !!moduleType } });
    }

    // Record payment & grant access
    await supabase.from('payments').insert({
      user_email: email,
      module_type: moduleType,
      provider: 'razorpay',
      order_id: orderId,
      amount_inr: amountInr,
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
          source: 'razorpay_webhook',
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_email,module_type' }
      );

    return res.json({ ok: true });
  } catch (e: any) {
    console.error('razorpay webhook error:', e);
    // Always 200 to avoid retries storm; log for debugging
    return res.json({ ok: false });
  }
}
