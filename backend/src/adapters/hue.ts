import fetch from "node-fetch";
import { ProviderAdapter, DiscoveredDevice, ActionResult } from "./types";

// Adaptador opcional para Philips Hue vía el acceso remoto (remote.meethue.com),
// útil porque no necesitas tener el puente Hue accesible: Hue lo expone en su nube.
// Requiere haber hecho el flujo OAuth de Hue una vez para obtener HUE_REMOTE_ACCESS_TOKEN
// y el HUE_BRIDGE_USERNAME (whitelist user) del puente. Ver docs/SETUP.md.

const BASE = "https://api.meethue.com/route";

function headers() {
  return {
    Authorization: `Bearer ${process.env.HUE_REMOTE_ACCESS_TOKEN}`,
    "Content-Type": "application/json",
  };
}

export const hueAdapter: ProviderAdapter = {
  id: "hue",

  isConfigured() {
    return !!(process.env.HUE_REMOTE_ACCESS_TOKEN && process.env.HUE_BRIDGE_USERNAME);
  },

  async listDevices(): Promise<DiscoveredDevice[]> {
    const user = process.env.HUE_BRIDGE_USERNAME;
    const resp = await fetch(`${BASE}/api/${user}/lights`, { headers: headers() });
    const data: any = await resp.json();

    return Object.entries(data || {}).map(([id, light]: [string, any]) => ({
      externalId: id,
      name: light.name,
      type: "light",
      capabilities: ["power", "brightness", "color"],
    }));
  },

  async execute(externalId, action, params = {}): Promise<ActionResult> {
    const user = process.env.HUE_BRIDGE_USERNAME;
    const body: Record<string, any> = {};

    switch (action) {
      case "turn_on":
        body.on = true;
        break;
      case "turn_off":
        body.on = false;
        break;
      case "set_brightness":
        body.on = true;
        body.bri = Math.max(1, Math.round(((params.level ?? 100) / 100) * 254));
        break;
      case "set_color":
        body.on = true;
        body.hue = params.hue ?? 0;
        body.sat = params.saturation ?? 254;
        break;
      default:
        return { ok: false, message: `Acción "${action}" no soportada por Hue` };
    }

    const resp = await fetch(`${BASE}/api/${user}/lights/${externalId}/state`, {
      method: "PUT",
      headers: headers(),
      body: JSON.stringify(body),
    });
    if (!resp.ok) return { ok: false, message: `Error Hue: ${resp.status} ${await resp.text()}` };
    return { ok: true, message: "Comando enviado a Hue" };
  },
};
