// server.ts
import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import { fileURLToPath } from "url";
import path from "path";

// Our API router (the file above)
import apiRoutes from "./api.js";
// Feature routers (direct mounting is also fine if you prefer)
import { scoreWritingRouter } from "./routes/score-writing.js";
import { gatekeeperRouter } from "./routes/gatekeeper.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 5000;

// CORS
app.use(
  cors({
    origin: [process.env.FRONTEND_URL || "http://localhost:5173"],
    credentials: true,
  })
);

// Body parsing
app.use(bodyParser.json({ limit: "5mb" }));
app.use(bodyParser.urlencoded({ extended: true }));

// Health
app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "backend", time: new Date().toISOString() });
});

// API routes
app.use("/api", apiRoutes);
// (Optional) Direct mounts too, if your frontend calls these paths:
app.use("/score-writing", scoreWritingRouter);
app.use("/gatekeeper", gatekeeperRouter);

// Static (if you need to serve files)
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Server running on :${port}`);
});
