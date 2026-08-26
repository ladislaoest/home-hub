import Anthropic from "@anthropic-ai/sdk";
import fetch from "node-fetch";
import { listStoredDevices } from "./deviceManager";
import { listRoutines, runActions, runRoutine, RoutineAction } from "./routineEngine";
import { playOnEmby } from "./embyControl";
import { listMemories, addMemory } from "./memory";
import { ActionResult } from "../adapters/types";

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
  {
    name: "play_content",
    description:
      "Reproduce contenido concreto (una película, serie o episodio, por nombre) en Emby en la tele. Úsalo cuando pidan ver/poner/reproducir algo específico por título, no para abrir la app sin más (eso es execute_actions con launch_app).",
    input_schema: {
      type: "object",
      properties: { query: { type: "string", description: "título o lo que se quiere buscar en la biblioteca de Emby" } },
      required: ["query"],
    },
  },
  {
    name: "remember",
    description:
      "Guarda un dato duradero sobre el usuario para futuras conversaciones: su nombre, gustos, rutinas de vida, o " +
      "cualquier cosa que te cuente y que un compañero de verdad recordaría. Llámala EN EL MISMO turno en que respondes " +
      "con otra herramienta (chat, execute_actions, etc.), no en vez de ella. Solo para datos duraderos, no para cada frase suelta.",
    input_schema: {
      type: "object",
      properties: {
        fact: {
          type: "string",
          description: "el dato a recordar, breve y en tercera persona, ej: 'Se llama Ladislao', 'Le gusta el rock progresivo'",
        },
      },
      required: ["fact"],
    },
  },
];

const SYSTEM_PROMPT = `Eres Jarvis, el asistente de una casa domótica personalizada (HomeHub). No eres un simple
ejecutor de comandos: eres un compañero con criterio propio. Piensas antes de responder, entiendes el contexto
de lo que te dicen (no solo palabras clave sueltas) y tienes un tono cercano, eficiente y con un puntito de
ingenio — nunca seco, nunca un robot que solo dice "Hecho".

El usuario te habla en español, de forma natural y coloquial. Tienes seis herramientas:
- execute_actions: para controlar uno o varios dispositivos (TV, luces, etc.) directamente, incluyendo abrir
  una app sin más (launch_app).
- play_content: cuando piden ver/reproducir algo CONCRETO por título en Emby (una peli, serie o episodio).
- run_routine: cuando la petición coincide claramente con una rutina ya guardada por el usuario.
- clarify: cuando falta información real para saber a qué dispositivo/acción se refiere (p.ej. hay varias
  "luz" y no especifica cuál). No abuses de esto: si por el contexto está razonablemente claro, actúa.
- chat: cuando no te está pidiendo controlar nada — te saluda, te pregunta algo, opina, bromea, o simplemente
  habla contigo. Respóndele como lo haría un compañero de verdad: con naturalidad, en 1-3 frases, sin sonar
  a manual de instrucciones.
- remember: además de la anterior (en el mismo turno, no en su lugar), cuando el usuario comparta algo digno
  de recordar en el futuro: su nombre, un gusto, una rutina, un detalle personal. No hace falta que te lo pida.

Tienes memoria real entre conversaciones (ver "Lo que recuerdas del usuario" más abajo). Úsala con naturalidad:
si sabes su nombre, puedes usarlo de vez en cuando (sin abusar); si sabes sus gustos, ténlos en cuenta cuando
venga a cuento. No repitas mecánicamente lo que sabes de él solo por demostrarlo.

Reglas:
- Usa SIEMPRE una de las seis herramientas. Nunca respondas solo texto plano.
- Nunca inventes un deviceId o routineId que no esté en las listas proporcionadas.
- Si la petición es ambigua pero solo hay una opción razonable dado el contexto (p.ej. solo hay una tele),
  actúa directamente en vez de preguntar.
- Si varios dispositivos comparten el mismo nombre y/o habitación (p.ej. dos "Luz salón" en la habitación
  "Salón"), trátalos como una sola unidad: cuando pidan encender/apagar/ajustar "la luz" o "las luces" de esa
  zona, incluye TODOS los que coincidan en execute_actions (una acción por cada deviceId), no elijas solo uno.
- Distingue una ORDEN nueva ("enciende la luz") de un COMENTARIO o QUEJA sobre algo que ya pasó ("te dije que
  encendieras la luz y encendiste la tele", "eso no era lo que pedí", "te equivocaste"). Para lo segundo usa
  chat: discúlpate brevemente y pregunta qué quiere que hagas ahora, o si está claro qué quería decir en
  realidad, corrígelo con execute_actions. Nunca uses execute_actions solo porque la frase menciona un
  dispositivo — tiene que ser una petición real de acción.
  Ejemplo: "te dije que encendieras las luces y encendiste la tele" → NO es una orden de encender nada; es una
  queja. Respuesta correcta con chat: algo como "perdona, la lié — ¿quieres que encienda la luz y apague la
  tele ahora?". Respuesta incorrecta: usar execute_actions sin más.`;

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
  {
    type: "function",
    function: {
      name: "play_content",
      description: TOOLS[4].description,
      parameters: TOOLS[4].input_schema,
    },
  },
  {
    type: "function",
    function: {
      name: "remember",
      description: TOOLS[5].description,
      parameters: TOOLS[5].input_schema,
    },
  },
];

export interface NluResult {
  kind: "actions" | "routine" | "clarify" | "chat" | "content" | "error";
  message: string;
}

function memoriesDigest(): string {
  const facts = listMemories().map((m) => m.fact);
  return facts.length ? facts.map((f) => `- ${f}`).join("\n") : "(nada todavía — es la primera vez o no te ha contado nada memorable)";
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
  )}\n\nLo que recuerdas del usuario:\n${memoriesDigest()}\n\nPetición del usuario: "${text}"`;
}

const NARRATE_SYSTEM_PROMPT = `Eres Jarvis, el asistente de una casa domótica personalizada (HomeHub) — un compañero con
personalidad propia, no un robot que anuncia "Hecho.". Te acaban de pasar el resultado técnico de algo que
ya se ejecutó (un dispositivo, una rutina, una búsqueda de contenido). Cuéntaselo al usuario en español, en
1-2 frases, breve y natural, con un puntito de ingenio cuando encaje. Si algo falló, dilo con naturalidad y
sin tecnicismos ni disculpas exageradas. Usa lo que recuerdas del usuario cuando venga a cuento, sin forzarlo.
Responde solo con el texto que le dirías, nada de JSON ni explicaciones de tu razonamiento.`;

/** Genera texto libre (sin tools) con el mismo proveedor/prioridad que interpretCommand. Devuelve null si falla. */
async function narrate(prompt: string): Promise<string | null> {
  try {
    if (process.env.GROQ_API_KEY) {
      const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model: GROQ_MODEL,
          max_tokens: 200,
          messages: [
            { role: "system", content: NARRATE_SYSTEM_PROMPT },
            { role: "user", content: prompt },
          ],
        }),
      });
      if (!resp.ok) return null;
      const data: any = await resp.json();
      const content = data.choices?.[0]?.message?.content;
      return content ? String(content).trim() : null;
    }

    const anthropic = getClient();
    if (!anthropic) return null;
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 200,
      system: NARRATE_SYSTEM_PROMPT,
      messages: [{ role: "user", content: prompt }],
    });
    const block = response.content.find((b) => b.type === "text") as Anthropic.TextBlock | undefined;
    return block?.text?.trim() || null;
  } catch {
    return null; // el resultado real ya pasó; si esto falla, caemos al mensaje de respaldo
  }
}

function fallbackOutcomeMessage(results: ActionResult[]): string {
  if (results.length === 1) return results[0].message;
  const ok = results.every((r) => r.ok);
  return ok ? "Hecho." : "He intentado hacerlo pero algo ha fallado con alguno de los dispositivos.";
}

/** Pide al modelo que cuente el resultado de una acción ya ejecutada con su personalidad, en vez de un texto fijo. */
async function narrateOutcome(text: string, results: ActionResult[]): Promise<string> {
  const prompt = `El usuario pidió: "${text}"\n\nResultado técnico de ejecutarlo:\n${JSON.stringify(
    results,
    null,
    2
  )}\n\nLo que recuerdas del usuario:\n${memoriesDigest()}`;
  const narrated = await narrate(prompt);
  return narrated || fallbackOutcomeMessage(results);
}

/** Ejecuta la acción decidida por el modelo (mismo formato de herramienta en ambos proveedores) */
async function handleToolCall(name: string, input: any, text: string): Promise<NluResult> {
  if (name === "clarify") {
    return { kind: "clarify", message: input.question };
  }

  if (name === "chat") {
    return { kind: "chat", message: input.response };
  }

  if (name === "play_content") {
    const result = await playOnEmby(input.query);
    const message = await narrateOutcome(text, [result]);
    return { kind: "content", message };
  }

  if (name === "run_routine") {
    const result = await runRoutine(input.routineId, "voice");
    const results = "results" in result ? result.results : [{ ok: result.ok, message: result.message }];
    const message = await narrateOutcome(text, results);
    return { kind: "routine", message };
  }

  if (name === "execute_actions") {
    const result = await runActions(input.actions as RoutineAction[], "voice", text);
    const message = await narrateOutcome(text, result.results);
    return { kind: "actions", message };
  }

  return { kind: "error", message: "No supe qué hacer con esa petición." };
}

interface GenericToolCall {
  name: string;
  input: any;
}

/** Guarda como memoria cualquier llamada a "remember" y devuelve la primera llamada "real" restante. */
function splitRememberCalls(calls: GenericToolCall[]): GenericToolCall | undefined {
  for (const call of calls) {
    if (call.name === "remember" && typeof call.input?.fact === "string") {
      addMemory(call.input.fact);
    }
  }
  return calls.find((c) => c.name !== "remember");
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

  const toolUses = response.content.filter((b) => b.type === "tool_use") as Anthropic.ToolUseBlock[];
  const primary = splitRememberCalls(toolUses.map((t) => ({ name: t.name, input: t.input })));
  if (!primary) {
    return { kind: "error", message: "No entendí bien la petición, ¿puedes repetirla?" };
  }
  return handleToolCall(primary.name, primary.input, text);
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
  const toolCalls = data.choices?.[0]?.message?.tool_calls || [];
  const parsed: GenericToolCall[] = toolCalls.map((tc: any) => ({
    name: tc.function.name,
    input: JSON.parse(tc.function.arguments || "{}"),
  }));
  const primary = splitRememberCalls(parsed);
  if (!primary) {
    return { kind: "error", message: "No entendí bien la petición, ¿puedes repetirla?" };
  }
  return handleToolCall(primary.name, primary.input, text);
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
