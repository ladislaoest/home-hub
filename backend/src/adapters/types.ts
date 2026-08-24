export interface DiscoveredDevice {
  externalId: string;
  name: string;
  type: "tv" | "light" | "switch" | "speaker" | "other";
  capabilities: string[]; // ej: ["power", "volume", "app_launch"] o ["power", "brightness", "color"]
}

export interface ActionResult {
  ok: boolean;
  message: string;
}

// Todos los adaptadores de proveedor (SmartThings, Tuya, Hue, Alexa...) implementan esta interfaz.
export interface ProviderAdapter {
  id: string; // "smartthings" | "tuya" | "hue" | "alexa"
  isConfigured(): boolean;
  listDevices(): Promise<DiscoveredDevice[]>;
  execute(externalId: string, action: string, params?: Record<string, any>): Promise<ActionResult>;
  /** Opcional: algunos proveedores (Alexa) pueden "hablar" un texto por un altavoz */
  speak?(externalId: string, text: string): Promise<ActionResult>;
}
