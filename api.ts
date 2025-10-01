// api.ts
import express from "express";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs-extra";
import { v4 as uuidv4 } from "uuid";

// Routers located in /routes
import { scoreWritingRouter } from "./routes/score-writing.js";
import { gatekeeperRouter } from "./routes/gatekeeper.js";

// Local services (these files sit next to api.ts)
import { sendEmailReport } from "./emailService.js";
import { generatePdfReport } from "./pdfService.js";

const router = express.Router();

// __dirname helper for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Data paths (adjust as you like)
const DATA_DIR = path.join(__dirname, "./data");
const ATTEMPTS_DIR = path.join(DATA_DIR, "attempts");
const UPLOADS_DIR = path.join(__dirname, "./uploads");

// Ensure folders exist at boot
fs.ensureDirSync(DATA_DIR);
fs.ensureDirSync(ATTEMPTS_DIR);
fs.ensureDirSync(UPLOADS_DIR);

// Health
router.get("/health", (_req, res) => {
  res.json({ ok: true, service: "api", time: new Date().toISOString() });
});

// Example: save a tiny attempt payload to /data/attempts
router.post("/attempts", express.json({ limit: "2mb" }), async (req, res) => {
  const id = uuidv4();
  const file = path.join(ATTEMPTS_DIR, `${id}.json`);
  await fs.writeJson(file, { id, at: Date.now(), payload: req.body }, { spaces: 2 });
  res.json({ saved: true, id });
});

// Example: create a PDF via pdfService.ts
router.post("/report/pdf", express.json({ limit: "2mb" }), async (req, res) => {
  try {
    const pdfBuffer = await generatePdfReport(req.body ?? {});
    res.setHeader("Content-Type", "application/pdf");
    res.send(pdfBuffer);
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? "PDF error" });
  }
});

// Example: send an email via emailService.ts
router.post("/report/email", express.json({ limit: "2mb" }), async (req, res) => {
  try {
    await sendEmailReport(req.body ?? {});
    res.json({ sent: true });
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? "Email error" });
  }
});

// Mount feature routers
router.use("/score-writing", scoreWritingRouter);
router.use("/gatekeeper", gatekeeperRouter);

export default router;
