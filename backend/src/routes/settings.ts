import { Router } from "express";

export const settingsRouter = Router();

// Informa al frontend qué proveedores están configurados (sin exponer secretos)
settingsRouter.get("/status", (_req, res) => {
  res.json({
    smartthings: !!process.env.SMARTTHINGS_TOKEN,
    tuya: !!(process.env.TUYA_ACCESS_ID && process.env.TUYA_ACCESS_SECRET && process.env.TUYA_USER_ID),
    hue: !!(process.env.HUE_REMOTE_ACCESS_TOKEN && process.env.HUE_BRIDGE_USERNAME),
    alexaMode: process.env.ALEXA_ANNOUNCE_MODE || "routine",
    claude: !!process.env.ANTHROPIC_API_KEY,
  });
});
