// backend/src/routes/payments.ts
import { Router } from "express";

const router = Router();

/**
 * POST /payments/order
 * body: { amountINR: number, brand?: "TLLI" | "IEBK" }
 * TLLI = thelasttryielts.com, IEBK = ieltsebooks.com
 */
router.post("/order", async (req, res) => {
  try {
    const amountINR = Number(req.body?.amountINR || 0);
    const brand = (req.body?.brand === "IEBK") ? "IEBK" : "TLLI"; // default TLLI
    if (!amountINR) return res.status(400).json({ error: "amountINR required" });

    const keyId = process.env.RAZORPAY_KEY_ID!;
    const keySecret = process.env.RAZORPAY_KEY_SECRET!;
    if (!keyId || !keySecret) return res.status(500).json({ error: "Missing Razorpay keys" });

    // basic auth header
    const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");

    const payload = {
      amount: amountINR * 100,   // paise
      currency: "INR",
      receipt: `${brand.toLowerCase()}_${Date.now()}`, // tlli_... or iebk_...
      payment_capture: 1,
      notes: { brand },          // useful for dashboard filtering
    };

    const r = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Basic ${auth}`,
      },
      body: JSON.stringify(payload),
    });

    const out = await r.json();
    if (!r.ok) return res.status(400).json(out);
    return res.json(out); // { id, amount, currency, ... }
  } catch (e:any) {
    return res.status(500).json({ error: e?.message || "Razorpay error" });
  }
});

export default router;
