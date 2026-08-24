import { Router } from "express";
import { listStoredDevices, syncDevices, renameDevice, deleteDevice, executeOnDevice } from "../services/deviceManager";

export const devicesRouter = Router();

devicesRouter.get("/", (_req, res) => {
  const devices = listStoredDevices().map((d) => ({ ...d, capabilities: JSON.parse(d.capabilities) }));
  res.json(devices);
});

devicesRouter.post("/sync", async (_req, res) => {
  const result = await syncDevices();
  res.json(result);
});

devicesRouter.patch("/:id", (req, res) => {
  const { name, room } = req.body || {};
  renameDevice(req.params.id, name, room ?? null);
  res.json({ ok: true });
});

devicesRouter.delete("/:id", (req, res) => {
  deleteDevice(req.params.id);
  res.json({ ok: true });
});

devicesRouter.post("/:id/action", async (req, res) => {
  const { action, params } = req.body || {};
  const result = await executeOnDevice(req.params.id, action, params);
  res.json(result);
});
