import { Router } from "express";
import { interpretCommand } from "../services/nlu";

export const alexaSkillRouter = Router();

// Endpoint que llama Alexa (no lleva nuestro login por token: Alexa no puede mandarlo).
// Como protección mínima, comprobamos que el applicationId de la skill coincide con el
// que configuraste en ALEXA_SKILL_ID, así una URL adivinada no puede hacer nada.
alexaSkillRouter.post("/", async (req, res) => {
  const body = req.body || {};
  const appId = body.session?.application?.applicationId || body.context?.System?.application?.applicationId;
  const expectedAppId = process.env.ALEXA_SKILL_ID;

  if (expectedAppId && appId !== expectedAppId) {
    return res.status(403).json({ error: "applicationId no coincide" });
  }

  const type = body.request?.type;

  if (type === "LaunchRequest") {
    return res.json(alexaResponse("Hola, soy Jarvis. ¿Qué necesitas?", false));
  }

  if (type === "SessionEndedRequest") {
    return res.json({ version: "1.0", response: {} });
  }

  if (type === "IntentRequest") {
    const intentName = body.request.intent?.name;

    if (intentName === "AMAZON.StopIntent" || intentName === "AMAZON.CancelIntent") {
      return res.json(alexaResponse("Hasta luego.", true));
    }
    if (intentName === "AMAZON.HelpIntent") {
      return res.json(alexaResponse("Puedes pedirme que controle tus dispositivos o ejecute una rutina, por ejemplo: enciende la luz del salón.", false));
    }

    const texto = body.request.intent?.slots?.texto?.value;
    if (!texto) {
      return res.json(alexaResponse("No te he entendido, ¿puedes repetirlo?", false));
    }

    try {
      const result = await interpretCommand(texto);
      return res.json(alexaResponse(result.message, result.kind !== "clarify"));
    } catch (err: any) {
      return res.json(alexaResponse("Ha habido un error hablando con Jarvis.", true));
    }
  }

  return res.json({ version: "1.0", response: {} });
});

function alexaResponse(text: string, endSession: boolean) {
  return {
    version: "1.0",
    response: {
      outputSpeech: { type: "PlainText", text },
      shouldEndSession: endSession,
    },
  };
}
