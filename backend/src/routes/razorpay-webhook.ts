// backend/src/routes/razorpay-webhook.ts
import type { Request, Response } from 'express';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE || '';
const RZP_WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || '';

const supabase =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE)
    : null;

// Helper: verify signature
function verifySignature(rawBody: Buffer, signature: string) {
  const expected = crypto
    .createHmac('sha256', RZP_WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

// Grant access (idempotent)
async function grantAccess({
  email,
  moduleType,
  orderId,
  amount,
  couponCode,
}: {
  email?: string;
  moduleType?: 'Academic' | 'General';
  orderId?: string;
  amount?: number;
  couponCode?: string;
}) {
  if (!supabase) return;

  // Record payment (adjust table/columns if needed)
  await supabase.from('payments').insert({
    user_email: email || null,
    module_type: moduleType || null,
    provider: 'razorpay',
    order_id: orderId || null,
    amount_inr: amount ?? null,
    coupon_code: couponCode || null,
    status: 'captured',
  });

  // Only grant access if we know the user email + module
  if (email && moduleType) {
    await supabase
      .from('user_access')
      .upsert(
        {
          user_email: email,
          module_type: moduleType,
          is_paid: true,
          source: 'razorpay_webhook',
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_email,module_type' }
      );
  }
}

// MAIN HANDLER (raw body required)
export async function razorpayWebhook(req: Request, res: Response) {
  try {
    if (!RZP_WEBHOOK_SECRET) return res.status(500).send('Missing webhook secret');

    const signature = (req.headers['x-razorpay-signature'] || '') as string;
    const raw = (req as any).body as Buffer; // express.raw puts Buffer here

    if (!signature || !raw || !verifySignature(raw, signature)) {
      return res.status(400).send('Invalid signature');
    }

    const event = JSON.parse(raw.toString('utf8'));

    // Common fields (structure depends on event)
    const type: string = event.event;
    const payment = event?.payload?.payment?.entity;
    const order = event?.payload?.order?.entity;

    // Try to recover email/module from payment/notes (prefill these in your order if possible)
    const email: string | undefined =
      payment?.email || payment?.notes?.email || order?.notes?.email;
    const moduleType =
      (payment?.notes?.module_type || order?.notes?.module_type) as
        | 'Academic'
        | 'General'
        | undefined;
    const couponCode: string | undefined = payment?.notes?.coupon || order?.notes?.coupon;
    const amountINR: number | undefined =
      typeof payment?.amount === 'number' ? Math.round(payment.amount / 100) : undefined;
    const orderId: string | undefined = payment?.order_id || order?.id;

    switch (type) {
      case 'payment.captured':
      case 'order.paid': {
        await grantAccess({
          email,
          moduleType,
          orderId,
          amount: amountINR,
          couponCode,
        });
        break;
      }
      case 'payment.failed': {
        // Optional: store failed attempt
        if (supabase && orderId) {
          await supabase.from('payments').insert({
            user_email: email || null,
            module_type: moduleType || null,
            provider: 'razorpay',
            order_id: orderId,
            amount_inr: amountINR ?? null,
            coupon_code: couponCode || null,
            status: 'failed',
          });
        }
        break;
      }
      default:
        // ignore other events
        break;
    }

    // Always respond quickly (Razorpay retries on non-2xx)
    return res.status(200).send('ok');
  } catch (e) {
    console.error('Razorpay webhook error:', e);
    return res.status(200).send('ok'); // still 200 to avoid repeated retries storm
  }
}
