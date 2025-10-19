import type { Request, Response } from 'express';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

// ENV
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE || '';
const RAZORPAY_WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || '';

const supabase =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE)
    : null;

function bad(res: Response, code: number, msg: string) {
  return res.status(code).json({ error: msg });
}

export default async function razorpayWebhook(req: Request, res: Response) {
  try {
    if (!RAZORPAY_WEBHOOK_SECRET) {
      return bad(res, 500, 'Webhook secret not configured');
    }
    if (!supabase) {
      return bad(res, 500, 'Database not configured');
    }

    // req.body is a Buffer because we used express.raw()
    const rawBody: Buffer = req.body as unknown as Buffer;
    const receivedSignature = (req.header('x-razorpay-signature') || '').toString();

    // Verify signature
    const expected = crypto
      .createHmac('sha256', RAZORPAY_WEBHOOK_SECRET)
      .update(rawBody)
      .digest('hex');

    if (!receivedSignature || expected !== receivedSignature) {
      return bad(res, 400, 'Invalid webhook signature');
    }

    // Parse event
    const event = JSON.parse(rawBody.toString('utf8'));

    // Handle both order.paid and payment.captured
    // Try to read from payment, then from order
    const paymentEntity = event?.payload?.payment?.entity || null;
    const orderEntity   = event?.payload?.order?.entity || null;

    // Prefer notes from payment; else from order
    const notes = (paymentEntity?.notes || orderEntity?.notes || {}) as Record<string, any>;

    const email       = (notes.email || notes.user_email || '').toString().trim();
    const moduleType  = (notes.module_type || notes.module || '').toString().trim();
    const couponCode  = (notes.coupon || '').toString().trim();

    const orderId     = (paymentEntity?.order_id || orderEntity?.id || '').toString();
    const paymentId   = (paymentEntity?.id || '').toString();

    // Amount: prefer payment.amount, else order.amount — convert paise -> INR
    const paise = Number(paymentEntity?.amount ?? orderEntity?.amount ?? 0);
    const amountInr = Number.isFinite(paise) ? Math.round(paise) / 100 : null;

    // Idempotency – if we already stored this payment_id, do nothing
    if (paymentId) {
      const { data: existing } = await supabase
        .from('payments')
        .select('id')
        .eq('provider', 'razorpay')
        .eq('payment_id', paymentId)
        .maybeSingle();

      if (!existing) {
        await supabase.from('payments').insert({
          provider: 'razorpay',
          order_id: orderId || null,
          payment_id: paymentId || null,
          user_email: email || null,
          module_type: moduleType || null,
          coupon_code: couponCode || null,
          amount_inr: amountInr,
          status: 'captured',
          source: 'webhook',
        });
      }
    }

    // If we have enough info, grant access
    if (email && moduleType) {
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
    }

    // Respond fast — Razorpay expects 2xx
    return res.json({ ok: true });
  } catch (err: any) {
    console.error('Webhook error:', err?.message || err);
    // Still return 200 to avoid Razorpay retries storm; log for investigation
    return res.json({ ok: true, received: true });
  }
}
