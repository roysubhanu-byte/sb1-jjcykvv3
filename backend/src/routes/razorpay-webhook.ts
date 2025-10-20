import crypto from 'crypto';
import type { Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';

// ---- ENV ----
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE ||
  '';

const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || '';

const supabase =
  SUPABASE_URL && SERVICE_KEY
    ? createClient(SUPABASE_URL, SERVICE_KEY)
    : null;

// Helper to safely pull a value from notes using multiple key variants
function pickNote(notes: Record<string, any> | undefined, keys: string[]): string | null {
  if (!notes) return null;
  for (const k of keys) {
    if (notes[k] != null && String(notes[k]).trim() !== '') {
      return String(notes[k]).trim();
    }
  }
  return null;
}

function verifySignature(raw: Buffer, signature: string, secret: string) {
  const hmac = crypto.createHmac('sha256', secret).update(raw);
  const expected = hmac.digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

/**
 * Razorpay sends different event payload shapes.
 * We handle:
 * - payment.captured    -> payload.payment.entity
 * - order.paid          -> payload.order.entity (and sometimes payment info under payload.payment.entity)
 */
export async function webhookRawHandler(req: Request, res: Response) {
  try {
    if (!WEBHOOK_SECRET) {
      console.error('WEBHOOK ERROR: Missing RAZORPAY_WEBHOOK_SECRET');
      return res.status(500).json({ error: 'Webhook secret not configured' });
    }

    const rawBody = (req as any).body as Buffer; // express.raw
    const signature = req.header('x-razorpay-signature') || '';

    if (!signature) {
      return res.status(400).json({ error: 'Missing signature' });
    }

    if (!verifySignature(rawBody, signature, WEBHOOK_SECRET)) {
      return res.status(400).json({ error: 'Invalid signature' });
    }

    // Parse JSON from raw buffer
    const payload = JSON.parse(rawBody.toString('utf8'));

    const event: string = payload?.event || '';
    let paymentEntity: any = null;
    let orderEntity: any = null;

    if (event === 'payment.captured') {
      paymentEntity = payload?.payload?.payment?.entity || null;
    } else if (event === 'order.paid') {
      orderEntity = payload?.payload?.order?.entity || null;
      paymentEntity = payload?.payload?.payment?.entity || null;
    } else {
      // Ignore other events; respond 200 so Razorpay stops retrying
      return res.json({ ok: true, ignored: event });
    }

    // Prefer payment entity for definitive values (amount, ids, notes)
    const notes = paymentEntity?.notes || orderEntity?.notes || {};
    const orderId = paymentEntity?.order_id || orderEntity?.id || '';
    const paymentId = paymentEntity?.id || '';
    const amountPaise = paymentEntity?.amount ?? orderEntity?.amount ?? 0;
    const amountINR = Number(amountPaise) / 100;

    // Accept both the old and the new key names
    const email =
      pickNote(notes, ['email']) || // same
      null;

    const moduleType =
      pickNote(notes, ['moduleType', 'module_type']) || null;

    const couponCode =
      pickNote(notes, ['couponCode', 'coupon']) || null;

    if (!email || !moduleType) {
      // We still 200 to stop retries, but log the reason
      console.warn('WEBHOOK: Missing email/moduleType in notes', { notes });
      return res.json({ ok: true, skipped: 'missing-email-or-moduleType' });
    }

    if (!supabase) {
      console.error('WEBHOOK ERROR: Supabase not configured');
      return res.status(500).json({ error: 'Database not configured' });
    }

    // 1) Record a payment row (columns you said exist)
    await supabase.from('payments').insert({
      user_email: email,
      module_type: moduleType,
      provider: 'razorpay',
      order_id: orderId || null,
      payment_id: paymentId || null,
      amount_inr: isFinite(amountINR) ? amountINR : null,
      coupon_code: couponCode || null,
      status: 'captured',
    });

    // 2) Grant access
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
  } catch (err) {
    console.error('WEBHOOK ERROR:', err);
    // Always return 200 to avoid repeated retries if it’s a data issue,
    // but you can change to 500 if you want Razorpay to retry.
    return res.json({ ok: true });
  }
}
