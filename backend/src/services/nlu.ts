import Anthropic from "@anthropic-ai/sdk";
import { listStoredDevices } from "./deviceManager";
import { listRoutines, runActions, runRoutine, RoutineAction } from "./routineEngine";

let client: Anthropic | null = null;
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}

const TOOLS: Anthropic.Tool[] = [
  {
    name: "execute_actions",
    description: "Ejecuta una o varias acciones directamente sobre dispositivos de la casa.",
    input_schema: {
      type: "object",
      properties: {
        actions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              deviceId: { type: "string", description: "id interno del dispositivo (de la lista proporcionada)" },
              action: {
                type: "string",
                description:
                  "turn_on | turn_off | set_brightness | set_color | volume_up | volume_down | set_volume | mute | unmute | launch_app | set_channel",
              },
              params: { type: "object", description: "parámetros opcionales, ej: {level: 50}" },
            },
            required: ["deviceId", "action"],
          },
        },
      },
      required: ["actions"],
    },
  },
  {
    name: "run_routine",
    description: "Ejecuta una rutina ya creada por el usuario, identificándola por su id.",
    input_schema: {
      type: "object",
      properties: { routineId: { type: "string" } },
      required: ["routineId"],
    },
  },
  {
    name: "clarify",
    description: "Usa esto cuando la petición es ambigua o falta información para saber qué dispositivo o acción ejecutar.",
    input_schema: {
      type: "object",
      properties: { question: { type: "string" } },
      required: ["question"],
    },
  },
];

const SYSTEM_PROMPT = `Eres el asistente de una casa domótica personalizada (HomeHub). El usuario te habla en español,
de forma natural y coloquial, y tú debes traducir lo que pide en llamadas a herramientas para controlar
sus dispositivos (TV Samsung, bombillas, etc.) o ejecutar rutinas guardadas.

Reglas:
- Usa SIEMPRE una herramienta (execute_actions, run_routine o clarify). Nunca respondas solo texto.
- Si la petición coincide claramente con el nombre de una rutina existente, usa run_routine.
- Si pide algo directo sobre uno o varios dispositivos ("enciende la luz del salón", "sube el volumen de la tele"),
  usa execute_actions con los deviceId correctos según la lista de dispositivos que se te da.
- Si no está claro a qué dispositivo se refiere (por ejemplo hay varias "luz" y no especifica cuál), usa clarify.
- Nunca inventes un deviceId o routineId que no esté en las listas proporcionadas.`;

export interface NluResult {
  kind: "actions" | "routine" | "clarify" | "error";
  message: string;
}

export async function interpretCommand(text: string): Promise<NluResult> {
  const anthropic = getClient();
  if (!anthropic) {
    return { kind: "error", message: "Falta configurar ANTHROPIC_API_KEY en el servidor." };
  }

  const devices = listStoredDevices().map((d) => ({
    id: d.id,
    nombre: d.name,
    habitacion: d.room,
    tipo: d.type,
    proveedor: d.provider,
  }));
  const routines = listRoutines().map((r) => ({ id: r.id, nombre: r.name }));

  const userContent = `Dispositivos disponibles:\n${JSON.stringify(devices, null, 2)}\n\nRutinas disponibles:\n${JSON.stringify(
    routines,
    null,
    2
  )}\n\nPetición del usuario: "${text}"`;

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    tools: TOOLS,
    tool_choice: { type: "any" },
    messages: [{ role: "user", content: userContent }],
  });

  const toolUse = response.content.find((b) => b.type === "tool_use") as Anthropic.ToolUseBlock | undefined;
  if (!toolUse) {
    return { kind: "error", message: "No entendí bien la petición, ¿puedes repetirla?" };
  }

  if (toolUse.name === "clarify") {
    const input = toolUse.input as { question: string };
    return { kind: "clarify", message: input.question };
  }

  if (toolUse.name === "run_routine") {
    const input = toolUse.input as { routineId: string };
    const result = await runRoutine(input.routineId, "voice");
    return {
      kind: "routine",
      message: result.ok ? "Hecho, he ejecutado la rutina." : "He intentado ejecutar la rutina pero algo ha fallado.",
    };
  }

  if (toolUse.name === "execute_actions") {
    const input = toolUse.input as { actions: RoutineAction[] };
    const result = await runActions(input.actions, "voice", text);
    return {
      kind: "actions",
      message: result.ok ? "Hecho." : "He intentado hacerlo pero algo ha fallado con alguno de los dispositivos.",
    };
  }

  return { kind: "error", message: "No supe qué hacer con esa petición." };
}
