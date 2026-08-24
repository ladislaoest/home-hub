import { Router } from "express";
import bcrypt from "bcryptjs";
import { issueToken } from "../auth";

export const authRouter = Router();

authRouter.post("/login", async (req, res) => {
  const { username, password } = req.body || {};
  const adminUser = process.env.ADMIN_USER || "";
  const adminPasswordHashOrPlain = process.env.ADMIN_PASSWORD || "";

  if (!adminUser || !adminPasswordHashOrPlain) {
    return res.status(500).json({ error: "El servidor no tiene configurado ADMIN_USER/ADMIN_PASSWORD" });
  }

  if (username !== adminUser) {
    return res.status(401).json({ error: "Usuario o contraseña incorrectos" });
  }

  // ADMIN_PASSWORD puede ser un hash bcrypt ($2a$...) o texto plano (se compara directo)
  const isHash = adminPasswordHashOrPlain.startsWith("$2");
  const valid = isHash
    ? await bcrypt.compare(password || "", adminPasswordHashOrPlain)
    : password === adminPasswordHashOrPlain;

  if (!valid) {
    return res.status(401).json({ error: "Usuario o contraseña incorrectos" });
  }

  const token = issueToken(username);
  res.json({ token });
});
