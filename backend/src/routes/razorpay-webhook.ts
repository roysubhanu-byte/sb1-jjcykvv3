import express from 'express';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

const router = express.Router();

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE || '';
const RZP_WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || '';

const supabase = (SUPABASE_URL && SUPABASE_SERVICE_ROLE)
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE)
  : null;

router.post('/razorpay/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    if (!RZP_WEBHOOK_SECRET) return res.status(500).send('secret missing');

    const signature = req.headers['x-razorpay-signature'] as string;
    const payload = req.body as Buffer;             // raw body because of HMAC
    const digest = crypto.createHmac('sha256', RZP_WEBHOOK_SECRET).update(payload).digest('hex');

    if (digest !== signature) return res.status(400).send('invalid signature');

    const event = JSON.parse(payload.toString('utf8'));

    // We only care after payment is captured/authorized
    if (event?.event === 'payment.captured' || event?.event === 'payment.authorized') {
      const payment = event.payload.payment.entity;

      // The order carries our notes (email, module_type, coupon, etc.)
      const orderNotes = payment?.notes || {};
      const email = orderNotes.email || event?.payload?.order?.entity?.notes?.email || null;
      const moduleType = orderNotes.module_type || event?.payload?.order?.entity?.notes?.module_type || null;
      const orderId = payment?.order_id || null;

      // Record payment
      if (supabase) {
        await supabase.from('payments').insert({
          user_email: email,
          module_type: moduleType,
          provider: 'razorpay',
          order_id: orderId,
          payment_id: payment?.id || null,
          amount_inr: Number(payment?.amount || 0) / 100,
          status: 'captured',
          coupon_code: orderNotes.coupon || null,
        }).select().maybeSingle();

        if (email && moduleType) {
          await supabase.from('user_access').upsert({
            user_email: email,
            module_type: moduleType,
            has_paid: true,
            source: 'razorpay_webhook',
            updated_at: new Date().toISOString(),
          }, { onConflict: 'user_email,module_type' });
        }
      }
    }

    return res.status(200).send('ok');
  } catch (e) {
    console.error('webhook error:', e);
    return res.status(200).send('ok'); // respond 200 so Razorpay stops retrying
  }
});

export default router;
