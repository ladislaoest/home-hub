import { Router } from "express";
import { interpretCommand } from "../services/nlu";
import { speak } from "../services/deviceManager";

export const commandRouter = Router();

// El frontend convierte voz -> texto en el propio navegador (Web Speech API)
// y nos manda el texto aquí. Nosotros lo interpretamos y ejecutamos.
commandRouter.post("/", async (req, res) => {
  const { text } = req.body || {};
  if (!text || typeof text !== "string") {
    return res.status(400).json({ error: "Falta el campo 'text'" });
  }
  try {
    const result = await interpretCommand(text);

    // Si Alexa está en modo "unofficial" (texto libre), que también responda por el Echo
    if (process.env.ALEXA_ANNOUNCE_MODE === "unofficial" && result.message) {
      speak("alexa", result.message).catch(() => {});
    }

    res.json(result);
  } catch (err: any) {
    res.status(500).json({ kind: "error", message: err.message });
  }
});
