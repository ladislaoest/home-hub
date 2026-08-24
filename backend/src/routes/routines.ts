import { Router } from "express";
import { listRoutines, createRoutine, deleteRoutine, setRoutineEnabled, runRoutine } from "../services/routineEngine";

export const routinesRouter = Router();

routinesRouter.get("/", (_req, res) => {
  const routines = listRoutines().map((r) => ({ ...r, actions: JSON.parse(r.actions) }));
  res.json(routines);
});

routinesRouter.post("/", (req, res) => {
  const { name, triggerType, triggerValue, actions } = req.body || {};
  if (!name || !triggerType || !Array.isArray(actions)) {
    return res.status(400).json({ error: "Faltan campos: name, triggerType, actions" });
  }
  const routine = createRoutine(name, triggerType, triggerValue ?? null, actions);
  res.json({ ...routine, actions: JSON.parse(routine.actions) });
});

routinesRouter.post("/:id/run", async (req, res) => {
  const result = await runRoutine(req.params.id, "manual");
  res.json(result);
});

routinesRouter.patch("/:id/enabled", (req, res) => {
  const { enabled } = req.body || {};
  setRoutineEnabled(req.params.id, !!enabled);
  res.json({ ok: true });
});

routinesRouter.delete("/:id", (req, res) => {
  deleteRoutine(req.params.id);
  res.json({ ok: true });
});
