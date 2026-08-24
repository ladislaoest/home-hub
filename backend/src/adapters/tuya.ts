import fetch from "node-fetch";
import crypto from "crypto";
import { ProviderAdapter, DiscoveredDevice, ActionResult } from "./types";

// Adaptador para bombillas/enchufes que se controlan con apps basadas en Tuya
// (Smart Life, Tuya Smart, y muchas marcas genéricas "compatibles con Alexa/Google" lo son).
// 1. Crea una cuenta y un proyecto "Cloud Development" en https://iot.tuya.com/
// 2. En el proyecto, vincula tu cuenta de la app Smart Life/Tuya (Devices > Link Tuya App Account)
//    para obtener el TUYA_USER_ID y que tus dispositivos aparezcan aquí.
// 3. Copia el Access ID / Access Secret del proyecto en el .env

const REGION_HOSTS: Record<string, string> = {
  eu: "https://openapi.tuyaeu.com",
  us: "https://openapi.tuyaus.com",
  cn: "https://openapi.tuyacn.com",
  in: "https://openapi.tuyain.com",
};

function host() {
  return REGION_HOSTS[process.env.TUYA_REGION || "eu"] || REGION_HOSTS.eu;
}

let cachedToken: { token: string; expiresAt: number } | null = null;

function sign(
  clientId: string,
  secret: string,
  extra: string, // token de acceso, o "" si aún no hay
  stringToSign: string,
  t: string
) {
  const str = clientId + extra + t + stringToSign;
  return crypto.createHmac("sha256", secret).update(str, "utf8").digest("hex").toUpperCase();
}

function stringToSign(method: string, path: string, body?: string) {
  const bodyHash = crypto
    .createHash("sha256")
    .update(body || "", "utf8")
    .digest("hex");
  const headersStr = ""; // no usamos cabeceras firmadas adicionales
  return `${method}\n${bodyHash}\n${headersStr}\n${path}`;
}

async function getToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) {
    return cachedToken.token;
  }
  const accessId = process.env.TUYA_ACCESS_ID || "";
  const accessSecret = process.env.TUYA_ACCESS_SECRET || "";
  const t = Date.now().toString();
  const path = "/v1.0/token?grant_type=1";
  const sts = stringToSign("GET", path);
  const signature = sign(accessId, accessSecret, "", sts, t);

  const resp = await fetch(host() + path, {
    method: "GET",
    headers: {
      client_id: accessId,
      sign: signature,
      t,
      sign_method: "HMAC-SHA256",
    },
  });
  const data: any = await resp.json();
  if (!data.success) throw new Error(`Tuya getToken falló: ${JSON.stringify(data)}`);

  cachedToken = {
    token: data.result.access_token,
    expiresAt: Date.now() + data.result.expire_time * 1000,
  };
  return cachedToken.token;
}

async function tuyaRequest(method: string, path: string, body?: any) {
  const accessId = process.env.TUYA_ACCESS_ID || "";
  const accessSecret = process.env.TUYA_ACCESS_SECRET || "";
  const token = await getToken();
  const t = Date.now().toString();
  const bodyStr = body ? JSON.stringify(body) : "";
  const sts = stringToSign(method, path, bodyStr);
  const signature = sign(accessId, accessSecret, token, sts, t);

  const resp = await fetch(host() + path, {
    method,
    headers: {
      client_id: accessId,
      access_token: token,
      sign: signature,
      t,
      sign_method: "HMAC-SHA256",
      "Content-Type": "application/json",
    },
    body: bodyStr || undefined,
  });
  return resp.json();
}

export const tuyaAdapter: ProviderAdapter = {
  id: "tuya",

  isConfigured() {
    return !!(process.env.TUYA_ACCESS_ID && process.env.TUYA_ACCESS_SECRET && process.env.TUYA_USER_ID);
  },

  async listDevices(): Promise<DiscoveredDevice[]> {
    const uid = process.env.TUYA_USER_ID;
    const data: any = await tuyaRequest("GET", `/v1.0/users/${uid}/devices`);
    if (!data.success) throw new Error(`Tuya listDevices falló: ${JSON.stringify(data)}`);

    return (data.result || []).map((d: any) => ({
      externalId: d.id,
      name: d.name,
      type: (d.category || "").startsWith("dj") ? "light" : "other",
      capabilities: ["power", "brightness", "color"],
    }));
  },

  async execute(externalId, action, params = {}): Promise<ActionResult> {
    // Los "code" dependen del modelo exacto, estos son los más comunes en bombillas Tuya
    const commandsByAction: Record<string, { code: string; value: any }[]> = {
      turn_on: [{ code: "switch_led", value: true }],
      turn_off: [{ code: "switch_led", value: false }],
      set_brightness: [{ code: "bright_value_v2", value: Math.round(((params.level ?? 100) / 100) * 1000) }],
      set_color: [
        {
          code: "colour_data_v2",
          value: { h: params.hue ?? 0, s: params.saturation ?? 1000, v: params.value ?? 1000 },
        },
      ],
    };

    const commands = commandsByAction[action];
    if (!commands) return { ok: false, message: `Acción "${action}" no soportada por Tuya` };

    const data: any = await tuyaRequest("POST", `/v1.0/iot-03/devices/${externalId}/commands`, { commands });
    if (!data.success) return { ok: false, message: `Error Tuya: ${JSON.stringify(data)}` };
    return { ok: true, message: "Comando enviado a Tuya" };
  },
};
