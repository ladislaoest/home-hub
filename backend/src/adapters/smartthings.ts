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

// IDs numéricos fijos que usan las Smart TV Samsung (Tizen) para sus apps preinstaladas.
// El nombre "YouTube" no sirve como argumento de launchApp; hace falta este ID.
const APP_IDS: Record<string, string> = {
  youtube: "111299001912",
  netflix: "11101200001",
  primevideo: "3201512006785",
  amazonprimevideo: "3201512006785",
  amazonprime: "3201512006785",
  prime: "3201512006785",
  disneyplus: "3201901017640",
  disney: "3201901017640",
  spotify: "3201606009684",
  hbomax: "3201601007625",
  max: "3201601007625",
  appletv: "3201807016597",
  appletvplus: "3201807016597",
  movistarplus: "3201710015037",
  emby: "3201606009872",
};

function resolveAppId(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const key = raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[^a-z0-9]/g, "");
  return APP_IDS[key] || raw; // si no está en la lista, se pasa tal cual (puede ser ya un ID válido)
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Comprueba el estado real tras un comando, en vez de asumir éxito solo porque SmartThings devolvió 200. */
async function verifyAttribute(externalId: string, capability: string, attribute: string, expected: string): Promise<boolean> {
  for (let i = 0; i < 3; i++) {
    await sleep(1500);
    const resp = await fetch(`${API_BASE}/devices/${externalId}/components/main/capabilities/${capability}/status`, {
      headers: authHeaders(),
    });
    if (resp.ok) {
      const data: any = await resp.json();
      if (String(data[attribute]?.value) === expected) return true;
    }
  }
  return false;
}

/** Si el TV está apagado, launchApp no hace nada aunque SmartThings responda 200. Lo encendemos y esperamos a que arranque. */
async function ensurePoweredOn(externalId: string): Promise<void> {
  const statusResp = await fetch(`${API_BASE}/devices/${externalId}/components/main/capabilities/switch/status`, {
    headers: authHeaders(),
  });
  if (statusResp.ok) {
    const status: any = await statusResp.json();
    if (status.switch?.value === "on") return;
  }

  await fetch(`${API_BASE}/devices/${externalId}/commands`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ commands: [{ component: "main", capability: "switch", command: "on", arguments: [] }] }),
  });
  await sleep(12000); // tiempo que tarda Tizen en arrancar y aceptar comandos de apps
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
      launch_app: { capability: "custom.launchapp", command: "launchApp", args: [resolveAppId(params.appId)] },
      search: {
        capability: "custom.tvsearch",
        command: "search",
        // El segundo argumento (url) es obligatorio para SmartThings; sin él cae al buscador
        // genérico del TV en vez de ir directo a resultados de YouTube.
        args: [String(params.query || ""), `https://www.youtube.com/results?search_query=${encodeURIComponent(params.query || "")}`],
      },
      set_channel: { capability: "tvChannel", command: "setTvChannel", args: [String(params.channel)] },
      set_brightness: { capability: "switchLevel", command: "setLevel", args: [params.level ?? 100] },
    };

    const cmd = commandMap[action];
    if (!cmd) return { ok: false, message: `Acción "${action}" no soportada por SmartThings` };

    if (action === "launch_app" || action === "search") {
      await ensurePoweredOn(externalId);
    }

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

    // Acciones que sí podemos comprobar de verdad consultando el estado después
    if (action === "turn_on" || action === "turn_off") {
      const ok = await verifyAttribute(externalId, "switch", "switch", action === "turn_on" ? "on" : "off");
      return ok
        ? { ok: true, message: "Hecho." }
        : { ok: false, message: "Le mandé el comando a la tele pero no he podido confirmar que cambiara de estado — puede estar desconectada." };
    }
    if (action === "mute" || action === "unmute") {
      const ok = await verifyAttribute(externalId, "audioMute", "mute", action === "mute" ? "muted" : "unmuted");
      return ok
        ? { ok: true, message: "Hecho." }
        : { ok: false, message: "Le mandé silenciar/activar el sonido pero no confirmo que se aplicara." };
    }

    // Acciones que SmartThings no expone forma de verificar (no hay atributo de "app activa" ni de
    // "resultado de búsqueda"): lo digo con honestidad en vez de afirmar un éxito que no puedo comprobar.
    if (action === "launch_app") {
      return { ok: true, message: "Le he pedido a la tele que abra la app. Dime si no se ha abierto, que no tengo forma de confirmarlo desde aquí." };
    }
    if (action === "search") {
      return { ok: true, message: "Le he mandado la búsqueda a la tele. Avísame si no ha aparecido nada." };
    }

    return { ok: true, message: "Comando enviado a SmartThings" };
  },
};
