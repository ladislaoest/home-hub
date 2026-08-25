import fetch from "node-fetch";
import { ActionResult } from "../adapters/types";
import { listStoredDevices } from "./deviceManager";

function embyHeaders() {
  return { "X-Emby-Token": process.env.EMBY_API_KEY || "" };
}

function baseUrl(): string | undefined {
  const url = process.env.EMBY_SERVER_URL;
  return url ? url.replace(/\/$/, "") : undefined;
}

export function isEmbyConfigured(): boolean {
  return !!(process.env.EMBY_SERVER_URL && process.env.EMBY_API_KEY);
}

/** Busca contenido en la biblioteca de Emby y lo reproduce en la sesión activa que parezca ser la TV. */
export async function playOnEmby(query: string): Promise<ActionResult> {
  const url = baseUrl();
  if (!url || !process.env.EMBY_API_KEY) {
    return { ok: false, message: "Falta configurar EMBY_SERVER_URL o EMBY_API_KEY en el servidor." };
  }

  try {
    const searchResp = await fetch(
      `${url}/Items?SearchTerm=${encodeURIComponent(query)}&IncludeItemTypes=Movie,Episode,Series&Recursive=true&Limit=5`,
      { headers: embyHeaders() }
    );
    if (!searchResp.ok) return { ok: false, message: `Error buscando en Emby: ${searchResp.status} ${await searchResp.text()}` };
    const searchData: any = await searchResp.json();
    const item = searchData.Items?.[0];
    if (!item) return { ok: false, message: `No encontré "${query}" en tu biblioteca de Emby.` };

    const sessionsResp = await fetch(`${url}/Sessions`, { headers: embyHeaders() });
    if (!sessionsResp.ok) return { ok: false, message: `Error consultando sesiones de Emby: ${sessionsResp.status}` };
    const sessions: any[] = await sessionsResp.json();

    // Preferimos hacer match contra el nombre real de la(s) TV que ya tenemos registradas
    // (p.ej. Emby llama la sesión "75" Crystal UHD"", igual que SmartThings), y si no,
    // caemos a una heurística genérica por si el nombre no coincide exactamente.
    const tvNames = listStoredDevices()
      .filter((d) => d.type === "tv")
      .map((d) => d.name.toLowerCase());
    const tvSession =
      sessions.find((s) => tvNames.some((name) => (s.DeviceName || "").toLowerCase().includes(name) || name.includes((s.DeviceName || "").toLowerCase()))) ||
      sessions.find((s) => (s.Client || "").toLowerCase().includes("samsung") || (s.DeviceName || "").toLowerCase().includes("tv"));
    if (!tvSession) {
      return { ok: false, message: `Encontré "${item.Name}" pero no veo la app de Emby abierta en la tele. Ábrela primero e inténtalo de nuevo.` };
    }

    const playResp = await fetch(`${url}/Sessions/${tvSession.Id}/Playing?ItemIds=${item.Id}&PlayCommand=PlayNow`, {
      method: "POST",
      headers: embyHeaders(),
    });
    if (!playResp.ok) return { ok: false, message: `Error mandando reproducir a Emby: ${playResp.status} ${await playResp.text()}` };

    return { ok: true, message: `Reproduciendo "${item.Name}" en la tele.` };
  } catch (err: any) {
    return { ok: false, message: `Error hablando con Emby: ${err.message}` };
  }
}
