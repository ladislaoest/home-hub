import { v4 as uuidv4 } from "uuid";
import { db } from "../db";

export interface StoredMemory {
  id: string;
  fact: string;
  created_at: string;
}

export function listMemories(): StoredMemory[] {
  return db.prepare("SELECT * FROM memories ORDER BY created_at").all() as StoredMemory[];
}

/** Guarda un dato duradero sobre el usuario (nombre, gustos, contexto de su vida). Evita duplicar un hecho idéntico. */
export function addMemory(fact: string): void {
  const trimmed = fact.trim();
  if (!trimmed) return;
  const existing = db.prepare("SELECT id FROM memories WHERE fact = ?").get(trimmed);
  if (existing) return;
  db.prepare("INSERT INTO memories (id, fact) VALUES (?, ?)").run(uuidv4(), trimmed);
}

export function deleteMemory(id: string): void {
  db.prepare("DELETE FROM memories WHERE id = ?").run(id);
}
