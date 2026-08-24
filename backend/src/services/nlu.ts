import Anthropic from "@anthropic-ai/sdk";
import fetch from "node-fetch";
import { listStoredDevices } from "./deviceManager";
import { listRoutines, runActions, runRoutine, RoutineAction } from "./routineEngine";

let client: Anthropic | null = null;
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}

const GROQ_MODEL = "openai/gpt-oss-120b";

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

// Mismas herramientas que TOOLS pero en formato OpenAI (el que usa la API de Groq)
const GROQ_TOOLS = [
  {
    type: "function",
    function: {
      name: "execute_actions",
      description: TOOLS[0].description,
      parameters: TOOLS[0].input_schema,
    },
  },
  {
    type: "function",
    function: {
      name: "run_routine",
      description: TOOLS[1].description,
      parameters: TOOLS[1].input_schema,
    },
  },
  {
    type: "function",
    function: {
      name: "clarify",
      description: TOOLS[2].description,
      parameters: TOOLS[2].input_schema,
    },
  },
];

export interface NluResult {
  kind: "actions" | "routine" | "clarify" | "error";
  message: string;
}

function buildUserContent(text: string): string {
  const devices = listStoredDevices().map((d) => ({
    id: d.id,
    nombre: d.name,
    habitacion: d.room,
    tipo: d.type,
    proveedor: d.provider,
  }));
  const routines = listRoutines().map((r) => ({ id: r.id, nombre: r.name }));

  return `Dispositivos disponibles:\n${JSON.stringify(devices, null, 2)}\n\nRutinas disponibles:\n${JSON.stringify(
    routines,
    null,
    2
  )}\n\nPetición del usuario: "${text}"`;
}

/** Ejecuta la acción decidida por el modelo (mismo formato de herramienta en ambos proveedores) */
async function handleToolCall(name: string, input: any, text: string): Promise<NluResult> {
  if (name === "clarify") {
    return { kind: "clarify", message: input.question };
  }

  if (name === "run_routine") {
    const result = await runRoutine(input.routineId, "voice");
    return {
      kind: "routine",
      message: result.ok ? "Hecho, he ejecutado la rutina." : "He intentado ejecutar la rutina pero algo ha fallado.",
    };
  }

  if (name === "execute_actions") {
    const result = await runActions(input.actions as RoutineAction[], "voice", text);
    return {
      kind: "actions",
      message: result.ok ? "Hecho." : "He intentado hacerlo pero algo ha fallado con alguno de los dispositivos.",
    };
  }

  return { kind: "error", message: "No supe qué hacer con esa petición." };
}

async function interpretWithClaude(text: string): Promise<NluResult> {
  const anthropic = getClient()!;
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    tools: TOOLS,
    tool_choice: { type: "any" },
    messages: [{ role: "user", content: buildUserContent(text) }],
  });

  const toolUse = response.content.find((b) => b.type === "tool_use") as Anthropic.ToolUseBlock | undefined;
  if (!toolUse) {
    return { kind: "error", message: "No entendí bien la petición, ¿puedes repetirla?" };
  }
  return handleToolCall(toolUse.name, toolUse.input, text);
}

async function interpretWithGroq(text: string): Promise<NluResult> {
  const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      max_tokens: 1024,
      tools: GROQ_TOOLS,
      tool_choice: "required",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserContent(text) },
      ],
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Groq API error ${resp.status}: ${body}`);
  }

  const data: any = await resp.json();
  const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
  if (!toolCall) {
    return { kind: "error", message: "No entendí bien la petición, ¿puedes repetirla?" };
  }
  const input = JSON.parse(toolCall.function.arguments || "{}");
  return handleToolCall(toolCall.function.name, input, text);
}

export async function interpretCommand(text: string): Promise<NluResult> {
  if (process.env.GROQ_API_KEY) {
    try {
      return await interpretWithGroq(text);
    } catch (err: any) {
      return { kind: "error", message: `Error hablando con Groq: ${err.message}` };
    }
  }

  if (getClient()) {
    try {
      return await interpretWithClaude(text);
    } catch (err: any) {
      return { kind: "error", message: `Error hablando con Claude: ${err.message}` };
    }
  }

  return { kind: "error", message: "Falta configurar GROQ_API_KEY o ANTHROPIC_API_KEY en el servidor." };
}
