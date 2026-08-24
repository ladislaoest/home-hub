import { v4 as uuidv4 } from "uuid";
import cron, { ScheduledTask } from "node-cron";
import { db } from "../db";
import { executeOnDevice, speak } from "./deviceManager";

export interface RoutineAction {
  deviceId?: string; // acción sobre un dispositivo
  action: string; // turn_on, turn_off, set_brightness, speak, ...
  params?: Record<string, any>;
  provider?: string; // para action: "speak"
  text?: string; // para action: "speak"
}

export interface StoredRoutine {
  id: string;
  name: string;
  trigger_type: "manual" | "cron" | "voice";
  trigger_value: string | null;
  actions: string; // JSON de RoutineAction[]
  enabled: number;
}

const scheduledTasks = new Map<string, ScheduledTask>();

export function listRoutines(): StoredRoutine[] {
  return db.prepare("SELECT * FROM routines ORDER BY name").all() as StoredRoutine[];
}

export function createRoutine(name: string, triggerType: string, triggerValue: string | null, actions: RoutineAction[]): StoredRoutine {
  const id = uuidv4();
  db.prepare(`
    INSERT INTO routines (id, name, trigger_type, trigger_value, actions, enabled)
    VALUES (?, ?, ?, ?, ?, 1)
  `).run(id, name, triggerType, triggerValue, JSON.stringify(actions));

  const routine = db.prepare("SELECT * FROM routines WHERE id = ?").get(id) as StoredRoutine;
  if (routine.trigger_type === "cron" && routine.trigger_value) {
    scheduleRoutine(routine);
  }
  return routine;
}

export function deleteRoutine(id: string) {
  db.prepare("DELETE FROM routines WHERE id = ?").run(id);
  const task = scheduledTasks.get(id);
  if (task) {
    task.stop();
    scheduledTasks.delete(id);
  }
}

export function setRoutineEnabled(id: string, enabled: boolean) {
  db.prepare("UPDATE routines SET enabled = ? WHERE id = ?").run(enabled ? 1 : 0, id);
  const task = scheduledTasks.get(id);
  if (task) {
    if (enabled) task.start();
    else task.stop();
  }
}

export async function runRoutine(id: string, source: "manual" | "routine" | "voice" = "manual") {
  const routine = db.prepare("SELECT * FROM routines WHERE id = ?").get(id) as StoredRoutine | undefined;
  if (!routine) return { ok: false, message: "Rutina no encontrada" };
  return runActions(JSON.parse(routine.actions), source, routine.name);
}

export async function runActions(actions: RoutineAction[], source: string, label: string) {
  const results = [];
  for (const act of actions) {
    let result;
    if (act.action === "speak" && act.provider && act.text) {
      result = await speak(act.provider, act.text);
    } else if (act.deviceId) {
      result = await executeOnDevice(act.deviceId, act.action, act.params);
    } else {
      result = { ok: false, message: "Acción de rutina mal formada" };
    }
    results.push(result);
  }
  const ok = results.every((r) => r.ok);
  db.prepare("INSERT INTO logs (id, source, input, result, ok) VALUES (?, ?, ?, ?, ?)").run(
    uuidv4(),
    source,
    label,
    JSON.stringify(results),
    ok ? 1 : 0
  );
  return { ok, results };
}

function scheduleRoutine(routine: StoredRoutine) {
  if (!routine.trigger_value || !cron.validate(routine.trigger_value)) {
    console.warn(`Expresión cron inválida para la rutina "${routine.name}": ${routine.trigger_value}`);
    return;
  }
  const task = cron.schedule(routine.trigger_value, () => {
    runRoutine(routine.id, "routine").catch((err) => console.error("Error ejecutando rutina programada:", err));
  });
  if (!routine.enabled) task.stop();
  scheduledTasks.set(routine.id, task);
}

/** Llamar una vez al arrancar el servidor para programar todas las rutinas tipo "cron" */
export function initScheduler() {
  const routines = listRoutines().filter((r) => r.trigger_type === "cron");
  for (const r of routines) scheduleRoutine(r);
  console.log(`Programadas ${routines.length} rutinas con cron`);
}
