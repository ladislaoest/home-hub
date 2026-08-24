import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "";
if (!JWT_SECRET) {
  console.warn("[AVISO] JWT_SECRET no está definido. Configúralo en el .env antes de desplegar.");
}

export function issueToken(username: string): string {
  return jwt.sign({ sub: username }, JWT_SECRET || "dev-secret-inseguro", { expiresIn: "30d" });
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: "No autenticado" });
  }
  try {
    jwt.verify(token, JWT_SECRET || "dev-secret-inseguro");
    next();
  } catch {
    return res.status(401).json({ error: "Sesión inválida o caducada" });
  }
}
