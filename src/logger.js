'use strict';

const db = require('./db');

const MAX_LOGS = 100;

const insertStmt = db.prepare(`
  INSERT INTO access_logs (method, path, status, headers, query, body)
  VALUES (@method, @path, @status, @headers, @query, @body)
`);

const countStmt = db.prepare(`SELECT COUNT(*) AS c FROM access_logs`);
const listStmt = db.prepare(`
  SELECT id, method, path, status, headers, query, body, created_at
  FROM access_logs
  ORDER BY id DESC
  LIMIT ? OFFSET ?
`);
const clearStmt = db.prepare(`DELETE FROM access_logs`);

const SKIP_HEADERS = new Set(['host', 'connection', 'content-length', 'content-type']);

function sanitizeHeaders(headers) {
  const out = {};
  for (const [k, v] of Object.entries(headers || {})) {
    if (!SKIP_HEADERS.has(String(k).toLowerCase())) {
      out[k] = v;
    }
  }
  return out;
}

function addLog(req, status) {
  const log = {
    method: req.method,
    path: req.path,
    status: typeof status === 'number' ? status : 0,
    headers: JSON.stringify(sanitizeHeaders(req.headers)),
    query: JSON.stringify(req.query || {}),
    body: JSON.stringify(req.body ? JSON.parse(JSON.stringify(req.body)) : {})
  };
  try {
    insertStmt.run(log);
  } catch (e) {
    console.error('[logger] insert failed:', e.message);
  }
  return log;
}

function getLogs({ limit = MAX_LOGS, offset = 0 } = {}) {
  const total = countStmt.get().c;
  const rows = listStmt.all(limit, offset).map((row) => ({
    id: row.id,
    timestamp: row.created_at,
    method: row.method,
    path: row.path,
    status: row.status,
    headers: safeParse(row.headers),
    query: safeParse(row.query),
    body: safeParse(row.body)
  }));
  return { total, items: rows };
}

function clearLogs() {
  clearStmt.run();
}

function safeParse(text) {
  try { return JSON.parse(text); } catch { return {}; }
}

module.exports = {
  addLog,
  getLogs,
  clearLogs
};