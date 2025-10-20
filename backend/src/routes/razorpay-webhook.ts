// backend/src/routes/razorpay-webhook.ts
import type { Request, Response } from 'express';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE || '';

const supabase =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE)
    : null;

/**
 * Helper: normalize notes regardless of key style.
 * Accepts moduleType/couponCode (new) OR module_type/coupon (old).
 */
function normalizeNotes(notes: any) {
  const n = notes && typeof notes === 'object' ? notes : {};
  return {
    email: n.email ?? n.user_email ?? null,
    moduleType: n.moduleType ?? n.module_type ?? null,
    couponCode: n.couponCode ?? n.coupon ?? null,
    listPriceINR: n.list_price_inr ? Number(n.list_price_inr) : null,
    finalPriceINR: n.final_price_inr ? Number(n.final_price_inr) : null,
  };
}

/**
 * IMPORTANT:
 * Set RAZORPAY_WEBHOOK_SECRET in Render to the exact same secret you set in Razorpay Dashboard.
 */
export async function razorpayWebhook(req: Request, res: Response) {
  try {
    const WEBHOOK_SECRET =
      process.env.RAZORPAY_WEBHOOK_SECRET || process.env.RAZORPAY_KEY_SECRET || '';

    if (!WEBHOOK_SECRET) {
      return res.status(500).json({ error: 'Webhook secret not configured' });
    }

    // Razorpay signs the RAW body. We must validate against the raw buffer.
    const signature = req.header('x-razorpay-signature') || '';
    const bodyBuf = req.body as Buffer; // express.raw() ensures Buffer

    const expected = crypto.createHmac('sha256', WEBHOOK_SECRET).update(bodyBuf).digest('hex');
    if (expected !== signature) {
      return res.status(400).json({ error: 'Invalid signature' });
    }

    const event = JSON.parse(bodyBuf.toString('utf8'));
    const eventType: string = event?.event || '';

    // We handle payment.captured and order.paid; you can add others if needed
    const paymentEntity = event?.payload?.payment?.entity || null;
    const orderEntity = event?.payload?.order?.entity || null;

    // Identify order/payment IDs and notes (payment notes override order notes if present)
    const notesRaw = (paymentEntity?.notes ?? orderEntity?.notes) || {};
    const notes = normalizeNotes(notesRaw);

    const orderId: string =
      paymentEntity?.order_id ||
      orderEntity?.id ||
      event?.payload?.order_id ||
      '';
    const paymentId: string = paymentEntity?.id || '';

    const amountPaise: number | null =
      typeof paymentEntity?.amount === 'number'
        ? paymentEntity.amount
        : typeof orderEntity?.amount === 'number'
        ? orderEntity.amount
        : null;
    const amountINR = amountPaise != null ? amountPaise / 100 : notes.finalPriceINR;

    // Only act on successful events
    const isSuccess =
      eventType === 'payment.captured' ||
      eventType === 'order.paid' ||
      paymentEntity?.status === 'captured';

    if (!isSuccess) {
      return res.json({ ok: true, ignored: true });
    }

    if (!supabase) {
      return res.status(500).json({ error: 'Database not configured' });
    }

    // Log payment
    await supabase.from('payments').insert({
      user_email: notes.email,
      module_type: notes.moduleType,
      provider: 'razorpay',
      order_id: orderId || null,
      payment_id: paymentId || null,
      amount_inr: amountINR ?? null,
      coupon_code: notes.couponCode || null,
      status: 'captured',
      source: 'razorpay_webhook',
    });

    // Flip access if we have email + moduleType
    if (notes.email && notes.moduleType) {
      await supabase
        .from('user_access')
        .upsert(
          {
            user_email: notes.email,
            module_type: notes.moduleType,
            has_paid: true,
            source: 'razorpay_webhook',
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_email,module_type' }
        );
    }

    return res.json({ ok: true });
  } catch (err: any) {
    console.error('razorpayWebhook error:', err);
    return res.status(500).json({ error: err?.message || 'Webhook failed' });
  }
}
