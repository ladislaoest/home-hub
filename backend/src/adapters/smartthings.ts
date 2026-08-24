import fetch from "node-fetch";
import { ProviderAdapter, DiscoveredDevice, ActionResult } from "./types";

// Documentación oficial: https://developer.smartthings.com/docs/api/public
// Genera un Personal Access Token (PAT) en https://account.smartthings.com/tokens
// Necesita, como mínimo, los scopes: r:devices:*, x:devices:*
const API_BASE = "https://api.smartthings.com/v1";

function authHeaders() {
  return {
    Authorization: `Bearer ${process.env.SMARTTHINGS_TOKEN}`,
    "Content-Type": "application/json",
  };
}

export const smartThingsAdapter: ProviderAdapter = {
  id: "smartthings",

  isConfigured() {
    return !!process.env.SMARTTHINGS_TOKEN;
  },

  async listDevices(): Promise<DiscoveredDevice[]> {
    const resp = await fetch(`${API_BASE}/devices`, { headers: authHeaders() });
    if (!resp.ok) throw new Error(`SmartThings listDevices falló: ${resp.status} ${await resp.text()}`);
    const data: any = await resp.json();

    return (data.items || []).map((d: any) => {
      const caps: string[] = (d.components || [])
        .flatMap((c: any) => c.capabilities || [])
        .map((c: any) => c.id);

      const isTv =
        (d.ocf?.ocfDeviceType || "").toLowerCase().includes("tv") ||
        (d.deviceTypeName || "").toLowerCase().includes("tv") ||
        (d.name || "").toLowerCase().includes("tv");

      return {
        externalId: d.deviceId,
        name: d.label || d.name,
        type: isTv ? "tv" : caps.includes("switchLevel") ? "light" : "other",
        capabilities: caps,
      } as DiscoveredDevice;
    });
  },

  async execute(externalId, action, params = {}): Promise<ActionResult> {
    // Traduce nuestras acciones genéricas a "commands" de SmartThings
    const commandMap: Record<string, { capability: string; command: string; args?: any[] }> = {
      turn_on: { capability: "switch", command: "on" },
      turn_off: { capability: "switch", command: "off" },
      volume_up: { capability: "audioVolume", command: "volumeUp" },
      volume_down: { capability: "audioVolume", command: "volumeDown" },
      set_volume: { capability: "audioVolume", command: "setVolume", args: [params.level ?? 20] },
      mute: { capability: "audioMute", command: "mute" },
      unmute: { capability: "audioMute", command: "unmute" },
      launch_app: { capability: "custom.launchapp", command: "launchApp", args: [params.appId] },
      set_channel: { capability: "tvChannel", command: "setTvChannel", args: [String(params.channel)] },
      set_brightness: { capability: "switchLevel", command: "setLevel", args: [params.level ?? 100] },
    };

    const cmd = commandMap[action];
    if (!cmd) return { ok: false, message: `Acción "${action}" no soportada por SmartThings` };

    const body = {
      commands: [
        {
          component: "main",
          capability: cmd.capability,
          command: cmd.command,
          arguments: cmd.args || [],
        },
      ],
    };

    const resp = await fetch(`${API_BASE}/devices/${externalId}/commands`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      return { ok: false, message: `Error SmartThings: ${resp.status} ${await resp.text()}` };
    }
    return { ok: true, message: "Comando enviado a SmartThings" };
  },
};
