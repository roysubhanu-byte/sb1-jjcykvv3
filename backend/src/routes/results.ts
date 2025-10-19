// server.ts (or routes/results.ts)
import express from "express";
import cors from "cors";
import jwt from "jsonwebtoken";
import { createClient } from "@supabase/supabase-js";

const app = express();
app.use(express.json());
app.use(cors({ origin: [/\.thelasttryielts\.com$/, /localhost:\d+$/], credentials: true }));

// ---- Env (Render → Settings → Environment) ----
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE!; // server only
const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET!;     // from Supabase Project Settings → API (JWT secret)

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false }
});

// --- helper to verify the user's access token coming from the frontend ---
function getUserIdFromAuthHeader(req: express.Request): string | null {
  const auth = req.headers.authorization; // "Bearer <supabase access token>"
  if (!auth?.startsWith("Bearer ")) return null;
  const token = auth.slice("Bearer ".length);
  try {
    const decoded = jwt.verify(token, SUPABASE_JWT_SECRET) as { sub?: string };
    return decoded?.sub ?? null; // Supabase user id
  } catch {
    return null;
  }
}

// --- shape the results exactly like your current finishAttempt output ---
async function buildResultsFromDB(attemptId: string) {
  // 1) attempt row
  const { data: attempt, error: aErr } = await supabase
    .from("attempts")
    .select("*")
    .eq("id", attemptId)
    .single();
  if (aErr || !attempt) throw new Error(aErr?.message || "Attempt not found");

  // 2) responses for the attempt (adjust columns to your schema)
  const { data: responses, error: rErr } = await supabase
    .from("responses")
    .select("*")
    .eq("attempt_id", attemptId)
    .order("created_at", { ascending: true });
  if (rErr) throw new Error(rErr.message);

  // 3) (Optional) join/lookup extra tables used by finishAttempt (prompts, keys, banding, etc.)
  // const { data: tasks } = await supabase.from("tasks").select("*").in("id", responses.map(r => r.task_id));

  // 4) Recreate finishAttempt shape.
  // If your finishAttempt already stores a computed payload in attempts.detailed_feedback or results_json,
  // prefer returning that for 1:1 parity.
  const results = {
    attempt_id: attempt.id,
    user_id: attempt.user_id,
    module: attempt.module,               // "Listening" | "Reading" | "Writing" | "Speaking"
    started_at: attempt.started_at,
    submitted_at: attempt.submitted_at,
    band_overall: attempt.band_overall ?? null,
    detailed_feedback: attempt.detailed_feedback ?? null,
    // You can keep the same split your UI expects:
    sections: {
      Listening: responses.filter(r => r.section === "Listening"),
      Reading:   responses.filter(r => r.section === "Reading"),
      Writing:   responses.filter(r => r.section?.startsWith?.("Writing")),
      Speaking:  responses.filter(r => r.section?.startsWith?.("Speaking")),
    },
    // passthrough for anything else your UI uses
    raw_attempt: attempt,
    raw_responses: responses,
  };

  return results;
}

// -------- GET /api/results/:attemptId -------------
app.get("/api/results/:attemptId", async (req, res) => {
  try {
    const userId = getUserIdFromAuthHeader(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const attemptId = req.params.attemptId;

    // check the attempt belongs to this user
    const { data: check, error: cErr } = await supabase
      .from("attempts")
      .select("id,user_id")
      .eq("id", attemptId)
      .single();
    if (cErr || !check) return res.status(404).json({ error: "Attempt not found" });
    if (check.user_id !== userId) return res.status(403).json({ error: "Forbidden" });

    // build results payload
    const results = await buildResultsFromDB(attemptId);
    return res.json(results);
  } catch (e: any) {
    console.error(e);
    return res.status(500).json({ error: e?.message ?? "Server error" });
  }
});

// (keep your existing PDF route, e.g., POST /api/report -> generatePdfReport)

app.listen(process.env.PORT || 3000, () => {
  console.log("API up on", process.env.PORT || 3000);
});
