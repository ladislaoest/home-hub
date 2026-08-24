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
import { syncDevices } from "./services/deviceManager";

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

  // El disco no es persistente en el plan gratuito: cada arranque parte de una base de datos
  // vacía. Como los dispositivos viven en la nube de cada proveedor, los recuperamos solos aquí
  // para no depender de que alguien pulse "Buscar dispositivos" a mano tras cada despliegue.
  syncDevices()
    .then((results) => console.log("Auto-sincronización de dispositivos al arrancar:", results))
    .catch((err) => console.error("Fallo al auto-sincronizar dispositivos:", err.message));
});
