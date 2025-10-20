import type { Request, Response } from 'express';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE || '';
const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || '';

const supabase =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE)
    : null;

/**
 * Razorpay sends RAW body. We must verify signature against the raw string.
 * Mounted with express.raw({ type: 'application/json' }) in server.ts
 */
export async function webhookRawHandler(req: Request, res: Response) {
  try {
    if (!WEBHOOK_SECRET) {
      console.error('Webhook: missing RAZORPAY_WEBHOOK_SECRET');
      return res.status(500).send('Missing secret');
    }

    const raw = (req as any).body as Buffer; // from express.raw
    const bodyStr = raw?.toString('utf8') ?? '';

    const signature = req.header('x-razorpay-signature') || '';
    const expected = crypto.createHmac('sha256', WEBHOOK_SECRET).update(bodyStr).digest('hex');

    if (signature !== expected) {
      console.warn('Webhook: signature mismatch');
      return res.status(400).send('Bad signature');
    }

    const event = JSON.parse(bodyStr) as {
      event?: string;
      payload?: {
        payment?: {
          entity?: {
            id?: string;
            order_id?: string;
            amount?: number; // paise
            currency?: string;
            email?: string;
            notes?: Record<string, any>;
            status?: string;
          };
        };
      };
    };

    if (event.event !== 'payment.captured') {
      // Acknowledge quickly for non-captured events
      return res.status(200).json({ ok: true, ignored: event.event });
    }

    const payment = event.payload?.payment?.entity || {};
    const email = payment.email || payment.notes?.email || null;

    // 👇 Your frontend sends these names:
    const moduleType =
      payment.notes?.moduleType ?? payment.notes?.module_type ?? null;
    const couponCode =
      payment.notes?.couponCode ?? payment.notes?.coupon ?? null;

    if (!supabase) {
      console.error('Webhook: Supabase not configured');
      return res.status(200).json({ ok: true }); // still ACK to Razorpay
    }

    // payments row (best-effort; avoid blocking)
    await supabase.from('payments').insert({
      user_email: email,
      module_type: moduleType,
      provider: 'razorpay',
      order_id: payment.order_id || null,
      payment_id: payment.id || null,
      amount_inr: typeof payment.amount === 'number' ? Math.round(payment.amount / 100) : null,
      coupon_code: couponCode || null,
      status: payment.status || 'captured'
    });

    // grant access
    if (email && moduleType) {
      await supabase
        .from('user_access')
        .upsert(
          {
            user_email: email,
            module_type: moduleType,
            has_paid: true,
            source: 'razorpay_webhook',
            updated_at: new Date().toISOString()
          },
          { onConflict: 'user_email,module_type' }
        );
    }

    // optionally record coupon usage (ignore errors)
    if (couponCode && email) {
      await supabase.from('coupon_usage').insert({
        coupon_code: couponCode,
        user_email: email,
        payment_id: payment.id || null
      });
      // optional rpc if you created it
      try {
        await supabase.rpc('increment_coupon_usage', { coupon_code: couponCode });
      } catch {}
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Webhook handler error:', err);
    // still ACK 200 to prevent Razorpay retries storm; log for ops
    return res.status(200).json({ ok: true });
  }
}
