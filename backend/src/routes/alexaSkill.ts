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
    return res.json(alexaResponse("Hola, soy Jarvis. ¿Qué necesitas?", false, "¿Qué necesitas?"));
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
      return res.json(
        alexaResponse(
          "Puedes pedirme que controle tus dispositivos o ejecute una rutina, por ejemplo: que encienda la luz del salón.",
          false,
          "¿Qué necesitas?"
        )
      );
    }

    const texto = body.request.intent?.slots?.texto?.value;
    if (!texto) {
      return res.json(alexaResponse("No te he entendido, ¿puedes repetirlo?", false, "¿Puedes repetirlo?"));
    }

    try {
      const result = await interpretCommand(texto);
      // Dejamos la sesión abierta tras cada respuesta, con reprompt: así, después de la primera vez
      // ("Alexa, abre Jarvis" o "Alexa, pregunta a Jarvis que..."), puedes seguir dando
      // órdenes seguidas ("que suba el volumen", "que apague la luz"...) sin repetir "Alexa",
      // y si te quedas callado unos segundos te vuelve a preguntar en vez de colgar directamente.
      return res.json(alexaResponse(result.message, false, "¿Algo más?"));
    } catch (err: any) {
      return res.json(alexaResponse("Ha habido un error hablando con Jarvis.", true));
    }
  }

  return res.json({ version: "1.0", response: {} });
});

function alexaResponse(text: string, endSession: boolean, repromptText?: string) {
  const response: any = {
    outputSpeech: { type: "PlainText", text },
    shouldEndSession: endSession,
  };
  if (!endSession && repromptText) {
    response.reprompt = { outputSpeech: { type: "PlainText", text: repromptText } };
  }
  return { version: "1.0", response };
}
