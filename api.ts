// api.ts
import express from "express";
import path from "path";
import fs from "fs-extra";
import { v4 as uuidv4 } from "uuid";

// Routers in THIS folder (no utils/, no routes/)
import { scoreWritingRouter } from "./scoreWriting.js";
import { gatekeeperRouter } from "./gatekeeper.js";

// Local services in THIS folder
import { sendEmailReport } from "./emailService.js";
import { generatePdfReport } from "./pdfService.js";

const router = express.Router();
const ROOT = process.cwd();

// --- Data paths
const DATA_DIR = path.join(ROOT, "data");
const ATTEMPTS_DIR = path.join(DATA_DIR, "attempts");
const UPLOADS_DIR = path.join(ROOT, "uploads");

// Ensure folders exist
fs.ensureDirSync(DATA_DIR);
fs.ensureDirSync(ATTEMPTS_DIR);
fs.ensureDirSync(UPLOADS_DIR);

// Health
router.get("/health", (_req, res) => {
  res.json({ ok: true, service: "api", time: new Date().toISOString() });
});

// Save attempt to /data/attempts
router.post("/attempts", express.json({ limit: "2mb" }), async (req, res) => {
  const id = uuidv4();
  const file = path.join(ATTEMPTS_DIR, `${id}.json`);
  await fs.writeJson(file, { id, at: Date.now(), payload: req.body }, { spaces: 2 });
  res.json({ saved: true, id });
});

// PDF
router.post("/report/pdf", express.json({ limit: "2mb" }), async (req, res) => {
  try {
    const pdfBuffer = await generatePdfReport(req.body ?? {});
    res.setHeader("Content-Type", "application/pdf");
    res.send(pdfBuffer);
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? "PDF error" });
  }
});

// Email
router.post("/report/email", express.json({ limit: "2mb" }), async (req, res) => {
  try {
    await sendEmailReport(req.body ?? {});
    res.json({ sent: true });
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? "Email error" });
  }
});

// Feature routers
router.use("/score-writing", scoreWritingRouter);
router.use("/gatekeeper", gatekeeperRouter);

export default router;
