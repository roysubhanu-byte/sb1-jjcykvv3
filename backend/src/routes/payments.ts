// backend/src/routes/payments.ts
import { Router } from "express";

const router = Router();

/**
 * Flexible request body (any of these will work):
 * - amountINR | priceINR | price | amount | total | finalPriceINR
 * - brand | site
 * - couponCode | coupon_code | coupon
 *
 * Response: Razorpay order JSON + { finalPriceINR }
 */
router.post("/order", async (req, res) => {
  try {
    const body = req.body || {};

    // list/original price (e.g., 499)
    const listPrice = Number(
      body.amountINR ?? body.priceINR ?? body.price ?? body.amount ?? body.total ?? 0
    );
    if (!listPrice) {
      return res.status(400).json({ error: "amountINR (or price) required" });
    }

    // brand tag for dashboard filtering (two sites)
    const brandRaw = body.brand ?? body.site;
    const brand = String(brandRaw || "TLLI").toUpperCase() === "IEBK" ? "IEBK" : "TLLI";

    // coupon (support several keys)
    const couponCode = String(
      body.couponCode ?? body.coupon_code ?? body.coupon ?? ""
    ).trim().toUpperCase();

    // client’s idea of final (we won’t trust it blindly)
    const clientFinal = Number(body.finalPriceINR ?? listPrice);

    // server decision: allow only known test coupons to drop to ₹1
    const ALLOWED_TEST_COUPONS = new Set(["TEST499TO1", "DEMO1RUPEE"]);
    const expectedFinal =
      couponCode && ALLOWED_TEST_COUPONS.has(couponCode) ? 1 : listPrice;

    const finalPriceINR = expectedFinal; // enforce

    // Razorpay credentials
    const keyId = process.env.RAZORPAY_KEY_ID!;
    const keySecret = process.env.RAZORPAY_KEY_SECRET!;
    if (!keyId || !keySecret) {
      return res.status(500).json({ error: "Missing Razorpay keys" });
    }
    const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");

    // Build order payload
    const payload = {
      amount: finalPriceINR * 100,           // paise
      currency: "INR",
      receipt: `${brand.toLowerCase()}_${Date.now()}`, // tlli_* or iebk_*
      payment_capture: 1,
      notes: {
        brand,
        list_price_inr: String(listPrice),
        final_price_inr: String(finalPriceINR),
        coupon: couponCode || "",
        guarded: String(clientFinal !== expectedFinal),
      },
    };

    // Call Razorpay REST (no SDK needed)
    const r = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${auth}`,
      },
      body: JSON.stringify(payload),
    });

    const out: any = await r.json(); // <- type as any so spread is OK for TS
    if (!r.ok) {
      return res.status(400).json(out); // pass Razorpay error through
    }

    // Return Razorpay order + the price actually charged
    return res.json({ ...out, finalPriceINR });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Razorpay error" });
  }
});

export default router;
