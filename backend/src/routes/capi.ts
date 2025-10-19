// backend/src/routes/capi.ts
import { Router } from "express";
import crypto from "crypto";

const router = Router();

const PIXEL_ID = process.env.META_PIXEL_ID!;
const ACCESS_TOKEN = process.env.META_ACCESS_TOKEN!;
if (!PIXEL_ID || !ACCESS_TOKEN) throw new Error("Missing META_PIXEL_ID or META_ACCESS_TOKEN");

const META_URL = `https://graph.facebook.com/v18.0/${PIXEL_ID}/events`;

function sha256Lower(v?: string | null) {
  if (!v) return undefined;
  const s = String(v).trim().toLowerCase();
  return crypto.createHash("sha256").update(s).digest("hex");
}
function getClientIP(req: any) {
  const xfwd = (req.headers["x-forwarded-for"] as string) || "";
  const first = xfwd.split(",")[0]?.trim();
  return first || (req.socket as any)?.remoteAddress || undefined;
}
function getUA(req: any) {
  return (req.headers["user-agent"] as string) || undefined;
}

/**
 * POST /capi/purchase
 * body: { event_id, value, currency, email?, order_id? }
 */
router.post("/purchase", async (req, res) => {
  try {
    const { event_id, value, currency, email, order_id } = req.body || {};
    if (!event_id) return res.status(400).json({ error: "Missing event_id" });
    if (typeof value !== "number" || !currency) {
      return res.status(400).json({ error: "Purchase needs numeric value + currency" });
    }

    const payload = {
      data: [
        {
          event_name: "Purchase",
          event_time: Math.floor(Date.now() / 1000),
          action_source: "website",
          event_source_url: "https://thelasttryielts.com/checkout/success",
          event_id,
          user_data: {
            em: email ? [sha256Lower(email)] : undefined,
            client_ip_address: getClientIP(req),
            client_user_agent: getUA(req),
          },
          custom_data: {
            value,
            currency,
            contents: [{ id: "IELTS_5in1", quantity: 1 }],
            content_type: "product",
            order_id,
          },
        },
      ],
    };

    const r = await fetch(`${META_URL}?access_token=${ACCESS_TOKEN}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const out: any = await r.json();
    if (!r.ok) return res.status(400).json(out);
    return res.json(out);
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "CAPI error" });
  }
});

export default router;
