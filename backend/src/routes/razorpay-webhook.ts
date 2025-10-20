import crypto from 'crypto';
import type { Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE ||
  '';
const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || '';

const supabase =
  SUPABASE_URL && SERVICE_KEY ? createClient(SUPABASE_URL, SERVICE_KEY) : null;

function pickNote(notes: Record<string, any> | undefined, keys: string[]): string | null {
  if (!notes) return null;
  for (const k of keys) {
    if (notes[k] != null && String(notes[k]).trim() !== '') return String(notes[k]).trim();
  }
  return null;
}

function verifySignature(raw: Buffer, signature: string, secret: string) {
  const h = crypto.createHmac('sha256', secret).update(raw).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(h));
}

export async function webhookRawHandler(req: Request, res: Response) {
  try {
    if (!WEBHOOK_SECRET) return res.status(500).json({ error: 'Webhook secret not configured' });

    const rawBody = (req as any).body as Buffer; // express.raw
    const signature = req.header('x-razorpay-signature') || '';
    if (!signature) return res.status(400).json({ error: 'Missing signature' });

    if (!verifySignature(rawBody, signature, WEBHOOK_SECRET)) {
      return res.status(400).json({ error: 'Invalid signature' });
    }

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
      return res.json({ ok: true, ignored: event });
    }

    const notes = paymentEntity?.notes || orderEntity?.notes || {};
    const orderId = paymentEntity?.order_id || orderEntity?.id || '';
    const paymentId = paymentEntity?.id || '';
    const amountPaise = paymentEntity?.amount ?? orderEntity?.amount ?? 0;
    const amountINR = Number(amountPaise) / 100;

    // NEW: read the names your frontend sends
    const email = pickNote(notes, ['email']);
    const moduleType = pickNote(notes, ['moduleType', 'module_type']); // accept both
    const couponCode = pickNote(notes, ['couponCode', 'coupon']);      // accept both

    if (!email || !moduleType) {
      console.warn('WEBHOOK: Missing email/moduleType', { notes });
      return res.json({ ok: true, skipped: 'missing-email-or-moduleType' });
    }

    if (!supabase) return res.status(500).json({ error: 'Database not configured' });

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
    return res.json({ ok: true }); // avoid infinite retries
  }
}
