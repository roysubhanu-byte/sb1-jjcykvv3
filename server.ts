// server.ts
import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import path from "path";

// Use process.cwd() so we don't need import.meta
const ROOT = process.cwd();

import apiRoutes from "./api.js";

const app = express();
const port = process.env.PORT || 5000;

app.use(
  cors({
    origin: [process.env.FRONTEND_URL || "http://localhost:5173"],
    credentials: true
  })
);
app.use(bodyParser.json({ limit: "5mb" }));
app.use(bodyParser.urlencoded({ extended: true }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "backend", time: new Date().toISOString() });
});

app.use("/api", apiRoutes);

// serve uploads if you need it
app.use("/uploads", express.static(path.join(ROOT, "uploads")));

app.listen(port, () => {
  console.log(`Server running on :${port}`);
});
