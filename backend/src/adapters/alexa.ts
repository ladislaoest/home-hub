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

// Dominio regional de Amazon (la cookie de sesión es específica de cada dominio: alexa.amazon.es,
// alexa.amazon.com, alexa.amazon.co.uk... tiene que coincidir con dónde iniciaste sesión).
const ALEXA_DOMAIN = process.env.ALEXA_DOMAIN || "alexa.amazon.es";

interface AlexaDeviceInfo {
  serialNumber: string;
  deviceType: string;
  deviceOwnerCustomerId: string;
  accountName: string;
}

/** Busca el Echo al que hablarle: por serial si se configuró ALEXA_ANNOUNCE_DEVICE_SERIAL, si no el primer Echo Show, si no el primero con micrófono. */
async function findTargetDevice(cookie: string): Promise<AlexaDeviceInfo | null> {
  const resp = await fetch(`https://${ALEXA_DOMAIN}/api/devices-v2/device`, {
    headers: { Cookie: cookie, "User-Agent": "Mozilla/5.0" },
  });
  if (!resp.ok) return null;
  const data: any = await resp.json();
  const devices: any[] = data.devices || [];

  const wantedSerial = process.env.ALEXA_ANNOUNCE_DEVICE_SERIAL;
  const match =
    (wantedSerial && devices.find((d) => d.serialNumber === wantedSerial)) ||
    devices.find((d) => (d.accountName || "").toLowerCase().includes("show")) ||
    devices.find((d) => (d.capabilities || []).includes("MICROPHONE"));

  if (!match) return null;
  return {
    serialNumber: match.serialNumber,
    deviceType: match.deviceType,
    deviceOwnerCustomerId: match.deviceOwnerCustomerId,
    accountName: match.accountName,
  };
}

async function speakUnofficial(text: string): Promise<ActionResult> {
  const cookie = process.env.ALEXA_COOKIE;
  if (!cookie) {
    return { ok: false, message: "Falta ALEXA_COOKIE en el .env" };
  }

  try {
    const device = await findTargetDevice(cookie);
    if (!device) {
      return { ok: false, message: "No encontré ningún altavoz Alexa al que hablar (revisa ALEXA_COOKIE/ALEXA_ANNOUNCE_DEVICE_SERIAL)." };
    }

    const csrfMatch = cookie.match(/csrf=([^;]+)/);
    const csrf = csrfMatch ? csrfMatch[1] : "";

    const payload = {
      behaviorId: "PREVIEW",
      sequenceJson: JSON.stringify({
        "@type": "com.amazon.alexa.behaviors.model.Sequence",
        startNode: {
          "@type": "com.amazon.alexa.behaviors.model.OpaquePayloadOperationNode",
          type: "Alexa.Speak",
          skillId: "amzn1.ask.1p.saysomething",
          operationPayload: {
            deviceType: device.deviceType,
            deviceSerialNumber: device.serialNumber,
            customerId: device.deviceOwnerCustomerId,
            locale: "es-ES",
            textToSpeak: text,
          },
        },
      }),
      status: "ENABLED",
    };

    const resp = await fetch(`https://${ALEXA_DOMAIN}/api/behaviors/preview`, {
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
    return { ok: true, message: `Texto enviado a ${device.accountName}` };
  } catch (err: any) {
    return { ok: false, message: `Error llamando a Alexa (no oficial): ${err.message}` };
  }
}

export const alexaAdapter: ProviderAdapter = {
  id: "alexa",

  isConfigured() {
    const mode = process.env.ALEXA_ANNOUNCE_MODE || "routine";
    if (mode === "unofficial") return !!process.env.ALEXA_COOKIE;
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
