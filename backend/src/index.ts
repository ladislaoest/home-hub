import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import "./db"; // inicializa la base de datos y crea las tablas si no existen
import { authRouter } from "./routes/auth";
import { devicesRouter } from "./routes/devices";
import { routinesRouter } from "./routes/routines";
import { commandRouter } from "./routes/command";
import { settingsRouter } from "./routes/settings";
import { alexaSkillRouter } from "./routes/alexaSkill";
import { requireAuth } from "./auth";
import { initScheduler } from "./services/routineEngine";

const app = express();
app.use(cors());
app.use(express.json());

// Rutas públicas
app.use("/api/auth", authRouter);
app.use("/api/alexa-skill", alexaSkillRouter); // llamada por Alexa, no por el login de la app

// Rutas protegidas (requieren estar logueado)
app.use("/api/devices", requireAuth, devicesRouter);
app.use("/api/routines", requireAuth, routinesRouter);
app.use("/api/command", requireAuth, commandRouter);
app.use("/api/settings", requireAuth, settingsRouter);

app.get("/api/health", (_req, res) => res.json({ ok: true }));

// Frontend estático (PWA)
const publicDir = path.join(__dirname, "..", "public");
app.use(express.static(publicDir));
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) return next();
  res.sendFile(path.join(publicDir, "index.html"));
});

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => {
  console.log(`HomeHub escuchando en el puerto ${PORT}`);
  initScheduler();
});
