import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "..", "data", "homehub.db");

// Asegura que la carpeta de la base de datos existe
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  room TEXT,
  provider TEXT NOT NULL,       -- smartthings | tuya | hue | alexa
  external_id TEXT NOT NULL,    -- id del dispositivo en el proveedor
  type TEXT NOT NULL,           -- tv | light | speaker | switch | ...
  capabilities TEXT NOT NULL DEFAULT '[]', -- JSON array
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS routines (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  trigger_type TEXT NOT NULL,   -- manual | cron | voice
  trigger_value TEXT,           -- expresión cron si aplica
  actions TEXT NOT NULL,        -- JSON array de acciones
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS logs (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,         -- voice | routine | manual
  input TEXT,
  result TEXT,
  ok INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);
