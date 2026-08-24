import { v4 as uuidv4 } from "uuid";
import { db } from "../db";
import { smartThingsAdapter } from "../adapters/smartthings";
import { tuyaAdapter } from "../adapters/tuya";
import { hueAdapter } from "../adapters/hue";
import { alexaAdapter } from "../adapters/alexa";
import { ProviderAdapter, ActionResult } from "../adapters/types";

export const adapters: ProviderAdapter[] = [smartThingsAdapter, tuyaAdapter, hueAdapter, alexaAdapter];

export interface StoredDevice {
  id: string;
  name: string;
  room: string | null;
  provider: string;
  external_id: string;
  type: string;
  capabilities: string; // JSON string
}

export function listStoredDevices(): StoredDevice[] {
  return db.prepare("SELECT * FROM devices ORDER BY room, name").all() as StoredDevice[];
}

/** Consulta cada proveedor configurado y guarda/actualiza los dispositivos encontrados */
export async function syncDevices(): Promise<{ provider: string; found: number; error?: string }[]> {
  const results = [];
  const upsert = db.prepare(`
    INSERT INTO devices (id, name, room, provider, external_id, type, capabilities)
    VALUES (@id, @name, @room, @provider, @external_id, @type, @capabilities)
    ON CONFLICT(id) DO NOTHING
  `);
  const findExisting = db.prepare("SELECT id FROM devices WHERE provider = ? AND external_id = ?");

  for (const adapter of adapters) {
    if (!adapter.isConfigured()) {
      results.push({ provider: adapter.id, found: 0, error: "No configurado" });
      continue;
    }
    try {
      const devices = await adapter.listDevices();
      for (const d of devices) {
        const existing = findExisting.get(adapter.id, d.externalId) as { id: string } | undefined;
        if (existing) continue; // ya lo teníamos; el nombre/room lo puede editar el usuario
        upsert.run({
          id: uuidv4(),
          name: d.name,
          room: null,
          provider: adapter.id,
          external_id: d.externalId,
          type: d.type,
          capabilities: JSON.stringify(d.capabilities),
        });
      }
      results.push({ provider: adapter.id, found: devices.length });
    } catch (err: any) {
      results.push({ provider: adapter.id, found: 0, error: err.message });
    }
  }
  return results;
}

export function renameDevice(id: string, name: string, room: string | null) {
  db.prepare("UPDATE devices SET name = ?, room = ? WHERE id = ?").run(name, room, id);
}

export function deleteDevice(id: string) {
  db.prepare("DELETE FROM devices WHERE id = ?").run(id);
}

/** Ejecuta una acción sobre un dispositivo guardado (por su id interno) */
export async function executeOnDevice(deviceId: string, action: string, params?: Record<string, any>): Promise<ActionResult> {
  const device = db.prepare("SELECT * FROM devices WHERE id = ?").get(deviceId) as StoredDevice | undefined;
  if (!device) return { ok: false, message: `Dispositivo ${deviceId} no encontrado` };

  const adapter = adapters.find((a) => a.id === device.provider);
  if (!adapter) return { ok: false, message: `Proveedor ${device.provider} desconocido` };

  return adapter.execute(device.external_id, action, params);
}

/** Pide a un adaptador que "hable" (de momento solo Alexa lo soporta) */
export async function speak(providerId: string, text: string): Promise<ActionResult> {
  const adapter = adapters.find((a) => a.id === providerId);
  if (!adapter || !adapter.speak) return { ok: false, message: `${providerId} no soporta hablar` };
  return adapter.speak("", text);
}
