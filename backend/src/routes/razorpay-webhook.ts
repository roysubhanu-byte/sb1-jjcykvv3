// backend/src/routes/razorpay-webhook.ts
import express from 'express';
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

const router = express.Router();

/**
 * NOTE: This router expects RAW body. In server.ts we mount it as:
 *   app.post('/webhooks/razorpay', express.raw({ type: 'application/json' }), webhookRawHandler)
 *   app.post('/api/webhooks/razorpay', express.raw({ type: 'application/json' }), webhookRawHandler)
 * We export webhookRawHandler below (a simple function), not a json-parsing router.
 */

export function webhookRawHandler(req: express.Request, res: express.Response) {
  try {
    if (!RZP_WEBHOOK_SECRET) {
      return res.status(500).send('Webhook secret not configured');
    }

    const signature = req.header('x-razorpay-signature') || '';
    const bodyString = req.body instanceof Buffer ? req.body.toString('utf8') : '';

    const expected = crypto
      .createHmac('sha256', RZP_WEBHOOK_SECRET)
      .update(bodyString)
      .digest('hex');

    if (expected !== signature) {
      return res.status(400).send('Invalid signature');
    }

    const event = JSON.parse(bodyString);

    // Handle successful capture
    if (event?.event === 'payment.captured' && event?.payload?.payment?.entity) {
      const pay = event.payload.payment.entity;
      const orderId = pay.order_id as string | undefined;
      const paymentId = pay.id as string | undefined;

      const notes = (pay.notes || {}) as Record<string, string>;
      const email = (notes.email || '').toLowerCase();
     const moduleType = notes.moduleType as 'Academic' | 'General' | undefined;

      const coupon = notes.coupon || '';

      const amountPaise = Number(pay.amount || 0);
      const amountInr = Math.round(amountPaise / 100);

      if (supabase) {
        // Record payment
        supabase.from('payments').insert({
          user_email: email || null,
          module_type: moduleType || null,
          provider: 'razorpay',
          order_id: orderId || null,
          payment_id: paymentId || null,
          amount_inr: amountInr || null,
          coupon_code: coupon || null,
          status: 'captured',
          source: 'webhook',
        }).then(() => {}).catch(() => {});

        // Grant access
        if (email && moduleType) {
          supabase
            .from('user_access')
            .upsert(
              {
                user_email: email,
                module_type: moduleType,
                has_paid: true,
                source: 'webhook',
                updated_at: new Date().toISOString(),
              },
              { onConflict: 'user_email,module_type' }
            )
            .then(() => {})
            .catch(() => {});
        }
      }
    }

    return res.status(200).send('ok');
  } catch (err) {
    console.error('Webhook error:', err);
    return res.status(200).send('ok'); // Reply 200 so Razorpay doesn’t retry forever
  }
}
