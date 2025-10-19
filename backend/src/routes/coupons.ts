// backend/src/routes/coupons.ts
import express from "express";
import { createClient } from "@supabase/supabase-js";

const router = express.Router();

// ENV (Render -> backend service -> Environment)
const supabaseUrl = process.env.SUPABASE_URL || "";
// You can name this either SUPABASE_SERVICE_ROLE or SUPABASE_SERVICE_ROLE_KEY.
// Just be consistent with what you set in Render.
const supabaseServiceKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE || "";

const supabase =
  supabaseUrl && supabaseServiceKey ? createClient(supabaseUrl, supabaseServiceKey) : null;

// --- Types for clarity (not required at runtime) ---
interface CouponValidationRequest {
  code: string;                       // e.g., "TEST499TO1"
  moduleType: "Academic" | "General"; // from UI
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

// Helpers
function now() { return new Date(); }
function toUpper(s?: string) { return (s || "").trim().toUpperCase(); }
function toLower(s?: string) { return (s || "").trim().toLowerCase(); }

/**
 * POST /api/coupons/validate
 * body: { code, moduleType }
 * returns: { valid: boolean, coupon?: {...}, error?: string }
 */
router.post("/validate", async (req, res) => {
  try {
    const { code, moduleType } = req.body as CouponValidationRequest;

    if (!code || !moduleType) {
      return res.status(400).json({ valid: false, error: "Coupon code and module type are required" });
    }
    if (!supabase) {
      return res.status(500).json({ valid: false, error: "Database not configured" });
    }

    const codeUpper = toUpper(code);
    const moduleNorm = toLower(moduleType); // "academic" | "general"

    // Fetch coupon
    const { data: coupon, error: fetchError } = await supabase
      .from("coupons")
      .select("*")
      .eq("code", codeUpper)
      .eq("is_active", true)
      .maybeSingle();

    if (fetchError) {
      console.error("Error fetching coupon:", fetchError);
      return res.status(500).json({ valid: false, error: "Failed to validate coupon" });
    }
    if (!coupon) {
      return res.json({ valid: false, error: "Invalid coupon code" } as CouponValidationResponse);
    }

    // Expiry
    if (coupon.expires_at && new Date(coupon.expires_at) < now()) {
      return res.json({ valid: false, error: "This coupon has expired" } as CouponValidationResponse);
    }

    // Module applicability (coupon.module_type might be 'both' | 'Academic' | 'General')
    const couponModule = toLower(coupon.module_type || "both"); // normalize
    if (couponModule !== "both" && couponModule !== moduleNorm) {
      const pretty = coupon.module_type || "this";
      return res.json({ valid: false, error: `This coupon is only valid for ${pretty} module` } as CouponValidationResponse);
    }

    // Usage limit
    if (coupon.max_uses !== null && coupon.current_uses >= coupon.max_uses) {
      return res.json({ valid: false, error: "This coupon has reached its usage limit" } as CouponValidationResponse);
    }

    const originalPrice = 499; // list price for TLLI; change if needed
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

/**
 * POST /api/coupons/record-usage
 * body: { couponCode, userEmail, userId?, paymentId? }
 * - Inserts into coupon_usage
 * - Calls Supabase function increment_coupon_usage(coupon_code text)
 */
router.post("/record-usage", async (req, res) => {
  try {
    const { couponCode, userEmail, userId, paymentId } = req.body;

    if (!couponCode || !userEmail) {
      return res.status(400).json({ error: "Coupon code and user email are required" });
    }
    if (!supabase) {
      return res.status(500).json({ error: "Database not configured" });
    }

    // Insert usage row
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

    // Increment usage counter on coupons table
    const { error: incError } = await supabase.rpc("increment_coupon_usage", {
      coupon_code: toUpper(couponCode),
    });
    if (incError) {
      // Not fatal to the user flow; log it for admin
      console.error("Error incrementing coupon usage:", incError);
    }

    return res.json({ success: true });
  } catch (error) {
    console.error("Error recording coupon usage:", error);
    return res.status(500).json({ error: "Failed to record coupon usage" });
  }
});

export { router as couponsRouter };
