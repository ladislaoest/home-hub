import { Router } from "express";
import { interpretCommand } from "../services/nlu";

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
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ kind: "error", message: err.message });
  }
});
