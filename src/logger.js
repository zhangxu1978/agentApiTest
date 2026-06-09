'use strict';

const logs = [];
const MAX_LOGS = 100;

function addLog(req) {
  const log = {
    id: Date.now() + Math.random().toString(36).substr(2, 9),
    timestamp: new Date().toISOString(),
    method: req.method,
    path: req.path,
    headers: Object.fromEntries(Object.entries(req.headers).filter(
      ([k]) => !['host', 'connection', 'content-length', 'content-type'].includes(k.toLowerCase())
    )),
    query: req.query || {},
    body: req.body ? JSON.parse(JSON.stringify(req.body)) : {}
  };
  logs.unshift(log);
  if (logs.length > MAX_LOGS) {
    logs.pop();
  }
  return log;
}

function getLogs() {
  return logs;
}

function clearLogs() {
  logs.length = 0;
}

module.exports = {
  addLog,
  getLogs,
  clearLogs
};