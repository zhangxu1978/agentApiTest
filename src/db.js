'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'mock.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS api_configs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT    NOT NULL,
  path            TEXT    NOT NULL UNIQUE,
  method          TEXT    NOT NULL,
  content_type    TEXT    NOT NULL DEFAULT 'application/json; charset=utf-8',
  response_status INTEGER NOT NULL DEFAULT 200,
  response_body   TEXT    NOT NULL,
  error_format    TEXT    NOT NULL,
  description     TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS api_params (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  config_id   INTEGER NOT NULL,
  parent_id   INTEGER,
  name        TEXT    NOT NULL,
  location    TEXT,
  type        TEXT    NOT NULL,
  required    INTEGER NOT NULL DEFAULT 0,
  min_length  INTEGER,
  max_length  INTEGER,
  min_value   REAL,
  max_value   REAL,
  pattern     TEXT,
  description TEXT,
  order_index INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (config_id) REFERENCES api_configs(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_id) REFERENCES api_params(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS api_headers (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  config_id INTEGER NOT NULL,
  name      TEXT    NOT NULL,
  required  INTEGER NOT NULL DEFAULT 0,
  pattern   TEXT,
  FOREIGN KEY (config_id) REFERENCES api_configs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS uploaded_files (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT    NOT NULL,
  original_name   TEXT    NOT NULL,
  original_path   TEXT    NOT NULL,
  md_path         TEXT    NOT NULL,
  mime_type       TEXT,
  size_bytes      INTEGER NOT NULL DEFAULT 0,
  source          TEXT    NOT NULL DEFAULT 'upload',
  description     TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_api_params_config ON api_params(config_id);
CREATE INDEX IF NOT EXISTS idx_api_params_parent  ON api_params(parent_id);
CREATE INDEX IF NOT EXISTS idx_api_headers_config ON api_headers(config_id);
CREATE INDEX IF NOT EXISTS idx_api_configs_path   ON api_configs(path);
CREATE INDEX IF NOT EXISTS idx_uploaded_files     ON uploaded_files(id);
`;

db.exec(SCHEMA);

// Lightweight migration: add columns if missing (for upgrading an old DB without losing data)
function ensureColumn(table, column, decl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${decl}`);
  }
}
ensureColumn('api_params', 'parent_id',   'parent_id INTEGER');
ensureColumn('api_params', 'order_index', 'order_index INTEGER NOT NULL DEFAULT 0');
ensureColumn('api_configs', 'source_file_id', 'source_file_id INTEGER');

module.exports = db;
