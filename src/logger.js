'use strict';

const db = require('./db');

const MAX_LOGS = 100;

const insertStmt = db.prepare(`
  INSERT INTO access_logs (method, path, status, headers, query, body)
  VALUES (@method, @path, @status, @headers, @query, @body)
`);

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

// date: 'YYYY-MM-DD'（本地日期，UTC+8）；传空表示不限日期
// pathLike: 模糊匹配关键字，传空表示不限接口
function getLogs({ limit = MAX_LOGS, offset = 0, date = '', pathLike = '' } = {}) {
  const where = [];
  const params = { limit, offset };
  if (date) {
    const { start, end } = buildRange(date);
    where.push('created_at >= @start AND created_at < @end');
    params.start = start;
    params.end = end;
  }
  if (pathLike) {
    where.push('path LIKE @pathLike');
    params.pathLike = `%${pathLike}%`;
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const total = db.prepare(`SELECT COUNT(*) AS c FROM access_logs ${whereSql}`).get(params).c;
  const rows = db
    .prepare(
      `SELECT id, method, path, status, headers, query, body, created_at
       FROM access_logs
       ${whereSql}
       ORDER BY id DESC
       LIMIT @limit OFFSET @offset`
    )
    .all(params)
    .map((row) => ({
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
  db.prepare(`DELETE FROM access_logs`).run();
}

// 本地日期（UTC+8） -> UTC 时间区间 [start, end)
function buildRange(dateStr) {
  const localStart = new Date(`${dateStr}T00:00:00+08:00`);
  const localEnd = new Date(localStart.getTime() + 24 * 60 * 60 * 1000);
  const fmt = (d) =>
    `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}:${String(d.getUTCSeconds()).padStart(2, '0')}`;
  return { start: fmt(localStart), end: fmt(localEnd) };
}

function safeParse(text) {
  try { return JSON.parse(text); } catch { return {}; }
}

module.exports = {
  addLog,
  getLogs,
  clearLogs,
  buildRange
};