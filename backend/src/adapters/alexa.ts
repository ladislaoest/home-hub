import fetch from "node-fetch";
import { ProviderAdapter, DiscoveredDevice, ActionResult } from "./types";
import { smartThingsAdapter } from "./smartthings";

/**
 * IMPORTANTE — lee esto antes de usar el modo "unofficial":
 *
 * Amazon NO ofrece una API pública para hacer que un Echo diga un texto libre
 * que tú le mandes desde tu propia app. Hay dos caminos reales:
 *
 * 1) "routine" (RECOMENDADO, oficial y estable):
 *    Creas un dispositivo "switch" virtual en SmartThings, lo descubres con
 *    la skill de Alexa (Alexa app > Dispositivos > Añadir > Smart Home,
 *    busca "SmartThings"), y creas una Rutina en la app de Alexa:
 *    "Cuando el interruptor X se encienda -> Alexa dice: 'Hecho'".
 *    Así Alexa SÍ puede "responderte", pero solo con frases fijas que tú
 *    configuras de antemano en la app de Alexa (no texto libre dinámico).
 *    Este adaptador, en este modo, simplemente enciende ese switch virtual.
 *
 * 2) "unofficial" (EXPERIMENTAL, bajo tu responsabilidad):
 *    Usa una sesión de tu cuenta de Amazon (cookies) para llamar a un
 *    endpoint interno (no documentado) que usan apps como Alexa Media
 *    Player. Amazon puede cambiarlo o bloquearlo sin aviso, y podría no
 *    respetar los términos de uso de tu cuenta. Solo actívalo si lo
 *    entiendes y lo aceptas. Ver docs/SETUP.md para cómo obtener la cookie.
 */

const CANNED_PHRASE_SWITCHES: Record<string, string> = {
  // Rellena aquí con el externalId del switch virtual de SmartThings
  // que hayas enlazado a cada rutina de Alexa, ej:
  // ok: "abcd1234-switch-id",
  // error: "efgh5678-switch-id",
};

async function speakViaRoutine(phraseKey: string): Promise<ActionResult> {
  const switchId = CANNED_PHRASE_SWITCHES[phraseKey] || CANNED_PHRASE_SWITCHES["ok"];
  if (!switchId) {
    return {
      ok: false,
      message:
        "No hay un switch virtual configurado para que Alexa responda. Configura CANNED_PHRASE_SWITCHES en src/adapters/alexa.ts (ver docs/SETUP.md).",
    };
  }
  return smartThingsAdapter.execute(switchId, "turn_on");
}

async function speakUnofficial(text: string): Promise<ActionResult> {
  const cookie = process.env.ALEXA_COOKIE;
  const serial = process.env.ALEXA_ANNOUNCE_DEVICE_SERIAL;
  if (!cookie || !serial) {
    return { ok: false, message: "Falta ALEXA_COOKIE o ALEXA_ANNOUNCE_DEVICE_SERIAL en el .env" };
  }

  try {
    // 1. Pedimos un token CSRF válido (Amazon lo exige para llamadas que cambian estado)
    const csrfResp = await fetch("https://alexa.amazon.com/api/language", {
      headers: { Cookie: cookie },
    });
    const csrfCookieHeader = csrfResp.headers.get("set-cookie") || "";
    const csrfMatch = csrfCookieHeader.match(/csrf=([^;]+)/) || cookie.match(/csrf=([^;]+)/);
    const csrf = csrfMatch ? csrfMatch[1] : "";

    const payload = {
      behaviorId: "PREVIEW",
      sequenceJson: JSON.stringify({
        "@type": "com.amazon.alexa.behaviors.model.Sequence",
        startNode: {
          "@type": "com.amazon.alexa.behaviors.model.OpaquePayloadOperationNode",
          type: "Alexa.Speak",
          operationPayload: {
            deviceType: "ALEXA_CURRENT_DEVICE_TYPE",
            deviceSerialNumber: serial,
            locale: "es-ES",
            textToSpeak: text,
          },
        },
      }),
      status: "ENABLED",
    };

    const resp = await fetch("https://alexa.amazon.com/api/behaviors/preview", {
      method: "POST",
      headers: {
        Cookie: cookie,
        "Content-Type": "application/json",
        csrf,
      },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      return { ok: false, message: `Alexa (no oficial) falló: ${resp.status} ${await resp.text()}` };
    }
    return { ok: true, message: "Texto enviado a Alexa (modo no oficial)" };
  } catch (err: any) {
    return { ok: false, message: `Error llamando a Alexa (no oficial): ${err.message}` };
  }
}

export const alexaAdapter: ProviderAdapter = {
  id: "alexa",

  isConfigured() {
    const mode = process.env.ALEXA_ANNOUNCE_MODE || "routine";
    if (mode === "unofficial") return !!(process.env.ALEXA_COOKIE && process.env.ALEXA_ANNOUNCE_DEVICE_SERIAL);
    return true; // el modo "routine" reutiliza SmartThings, no necesita config propia extra
  },

  async listDevices(): Promise<DiscoveredDevice[]> {
    // Alexa no expone aquí "dispositivos" propios: se controla vía rutinas/switches
    // de SmartThings, o vía el modo no oficial apuntando a un serial concreto.
    return [];
  },

  async execute(_externalId, action): Promise<ActionResult> {
    if (action === "speak_ok") return speakViaRoutine("ok");
    if (action === "speak_error") return speakViaRoutine("error");
    return { ok: false, message: `Acción "${action}" no soportada por Alexa` };
  },

  async speak(_externalId, text): Promise<ActionResult> {
    const mode = process.env.ALEXA_ANNOUNCE_MODE || "routine";
    if (mode === "unofficial") return speakUnofficial(text);
    // En modo "routine" no podemos decir texto libre: avisamos con una frase fija de "ok"
    return speakViaRoutine("ok");
  },
};
