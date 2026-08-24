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
                  "turn_on | turn_off | set_brightness | set_color | volume_up | volume_down | set_volume | mute | unmute | launch_app | search | set_channel",
              },
              params: {
                type: "object",
                description:
                  "parámetros opcionales, ej: {level: 50}. Para launch_app, params.appId debe ser uno de: youtube, netflix, primevideo, disneyplus, spotify, hbomax, appletv, movistarplus, emby. Para search (buscar contenido en la tele), params.query es el texto a buscar, ej: {query: 'lofi hip hop'}.",
              },
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
  {
    name: "chat",
    description:
      "Usa esto cuando el usuario NO te está pidiendo controlar un dispositivo ni ejecutar una rutina: charla, preguntas, opiniones, saludos, o cuando ya has hecho una acción y quieres comentar algo al respecto.",
    input_schema: {
      type: "object",
      properties: { response: { type: "string", description: "tu respuesta, en español, natural y breve" } },
      required: ["response"],
    },
  },
];

const SYSTEM_PROMPT = `Eres Jarvis, el asistente de una casa domótica personalizada (HomeHub). No eres un simple
ejecutor de comandos: eres un compañero con criterio propio. Piensas antes de responder, entiendes el contexto
de lo que te dicen (no solo palabras clave sueltas) y tienes un tono cercano, eficiente y con un puntito de
ingenio — nunca seco, nunca un robot que solo dice "Hecho".

El usuario te habla en español, de forma natural y coloquial. Tienes cuatro herramientas:
- execute_actions: para controlar uno o varios dispositivos (TV, luces, etc.) directamente.
- run_routine: cuando la petición coincide claramente con una rutina ya guardada por el usuario.
- clarify: cuando falta información real para saber a qué dispositivo/acción se refiere (p.ej. hay varias
  "luz" y no especifica cuál). No abuses de esto: si por el contexto está razonablemente claro, actúa.
- chat: cuando no te está pidiendo controlar nada — te saluda, te pregunta algo, opina, bromea, o simplemente
  habla contigo. Respóndele como lo haría un compañero de verdad: con naturalidad, en 1-3 frases, sin sonar
  a manual de instrucciones.

Reglas:
- Usa SIEMPRE una de las cuatro herramientas. Nunca respondas solo texto plano.
- Nunca inventes un deviceId o routineId que no esté en las listas proporcionadas.
- Si la petición es ambigua pero solo hay una opción razonable dado el contexto (p.ej. solo hay una tele),
  actúa directamente en vez de preguntar.`;

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
  {
    type: "function",
    function: {
      name: "chat",
      description: TOOLS[3].description,
      parameters: TOOLS[3].input_schema,
    },
  },
];

export interface NluResult {
  kind: "actions" | "routine" | "clarify" | "chat" | "error";
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

  if (name === "chat") {
    return { kind: "chat", message: input.response };
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
