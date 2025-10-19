// backend/src/routes/coupons.ts
import express from "express";
import { createClient } from "@supabase/supabase-js";

const router = express.Router();

const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseServiceKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE || "";
const supabase =
  supabaseUrl && supabaseServiceKey ? createClient(supabaseUrl, supabaseServiceKey) : null;

interface CouponValidationRequest {
  code: string;
  moduleType: "Academic" | "General";
}
interface CouponValidationResponse {
  valid: boolean;
  coupon?: {
    code: string;
    finalPriceInr: number;
    originalPriceInr: number;
    discountAmount: number;
  };
  error?: string;
}

const toUpper = (s?: string) => (s || "").trim().toUpperCase();
const toLower = (s?: string) => (s || "").trim().toLowerCase();

router.post("/validate", async (req, res) => {
  try {
    const { code, moduleType } = req.body as CouponValidationRequest;
    if (!code || !moduleType) {
      return res.status(400).json({ valid: false, error: "Coupon code and module type are required" });
    }
    if (!supabase) return res.status(500).json({ valid: false, error: "Database not configured" });

    const { data: coupon, error: fetchError } = await supabase
      .from("coupons")
      .select("*")
      .eq("code", toUpper(code))
      .eq("is_active", true)
      .maybeSingle();

    if (fetchError) {
      console.error("Error fetching coupon:", fetchError);
      return res.status(500).json({ valid: false, error: "Failed to validate coupon" });
    }
    if (!coupon) return res.json({ valid: false, error: "Invalid coupon code" } as CouponValidationResponse);

    if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) {
      return res.json({ valid: false, error: "This coupon has expired" } as CouponValidationResponse);
    }

    const moduleNorm = toLower(moduleType);
    const couponModule = toLower(coupon.module_type || "both");
    if (couponModule !== "both" && couponModule !== moduleNorm) {
      return res.json({ valid: false, error: `This coupon is only valid for ${coupon.module_type} module` } as CouponValidationResponse);
    }

    if (coupon.max_uses !== null && coupon.current_uses >= coupon.max_uses) {
      return res.json({ valid: false, error: "This coupon has reached its usage limit" } as CouponValidationResponse);
    }

    const originalPrice = 499;
    const finalPrice = Number(coupon.final_price_inr ?? originalPrice);
    const discount = Math.max(0, originalPrice - finalPrice);

    return res.json({
      valid: true,
      coupon: {
        code: coupon.code,
        finalPriceInr: finalPrice,
        originalPriceInr: originalPrice,
        discountAmount: discount,
      },
    } as CouponValidationResponse);
  } catch (error) {
    console.error("Error validating coupon:", error);
    return res.status(500).json({ valid: false, error: "An error occurred while validating the coupon" });
  }
});

router.post("/record-usage", async (req, res) => {
  try {
    const { couponCode, userEmail, userId, paymentId } = req.body;
    if (!couponCode || !userEmail) {
      return res.status(400).json({ error: "Coupon code and user email are required" });
    }
    if (!supabase) return res.status(500).json({ error: "Database not configured" });

    const { error: usageError } = await supabase.from("coupon_usage").insert({
      coupon_code: toUpper(couponCode),
      user_email: userEmail,
      user_id: userId || null,
      payment_id: paymentId || null,
    });
    if (usageError) {
      console.error("Error recording coupon usage:", usageError);
      return res.status(500).json({ error: "Failed to record coupon usage" });
    }

    const { error: incError } = await supabase.rpc("increment_coupon_usage", {
      coupon_code: toUpper(couponCode),
    });
    if (incError) console.error("Error incrementing coupon usage:", incError);

    return res.json({ success: true });
  } catch (error) {
    console.error("Error recording coupon usage:", error);
    return res.status(500).json({ error: "Failed to record coupon usage" });
  }
});

export { router as couponsRouter };
