'use strict';

const db = require('./db');

const ALLOWED_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];
const ALLOWED_LOCATIONS = ['query', 'body', 'path'];
const ALLOWED_TYPES = ['string', 'number', 'boolean', 'object', 'array'];

function nowIso() {
  return new Date().toISOString();
}

function normalizeBody(body) {
  if (body === undefined || body === null) return null;
  return String(body);
}

function validateTree(params, opts = {}) {
  // opts.topLevel = true if validating the outermost level (location required)
  const errors = [];
  for (const [i, p] of params.entries()) {
    const prefix = opts.path ? opts.path + '.' + (p.name || `?${i}`) : (p.name || `?${i}`);
    if (!p.name || !String(p.name).trim()) {
      errors.push(`params[${i}].name 必填`);
    }
    if (opts.topLevel) {
      if (!ALLOWED_LOCATIONS.includes(p.location)) {
        errors.push(`params[${i}].location 必须是 ${ALLOWED_LOCATIONS.join('/')}`);
      }
    }
    if (!ALLOWED_TYPES.includes(p.type)) {
      errors.push(`params[${i}].type 必须是 ${ALLOWED_TYPES.join('/')}`);
    }
    if (p.type !== 'object' && p.type !== 'array' && Array.isArray(p.children) && p.children.length) {
      errors.push(`params[${i}] 类型为 ${p.type} 时不能有子参数`);
    }
    if ((p.type === 'object' || p.type === 'array') && Array.isArray(p.children)) {
      errors.push(...validateTree(p.children, { path: prefix, topLevel: false }).map((e) => `${prefix}: ${e}`));
    }
  }
  return errors;
}

function validateConfigPayload(payload, { partial = false } = {}) {
  const errors = [];
  if (!partial || payload.name !== undefined) {
    if (!payload.name || !String(payload.name).trim()) {
      errors.push('name 必填');
    }
  }
  if (!partial || payload.path !== undefined) {
    if (!payload.path || !String(payload.path).startsWith('/')) {
      errors.push('path 必填且必须以 / 开头');
    }
  }
  if (!partial || payload.method !== undefined) {
    if (!ALLOWED_METHODS.includes(String(payload.method).toUpperCase())) {
      errors.push(`method 必须是 ${ALLOWED_METHODS.join('/')} 之一`);
    }
  }
  if (payload.response_status !== undefined && payload.response_status !== null && payload.response_status !== '') {
    const n = Number(payload.response_status);
    if (!Number.isInteger(n) || n < 100 || n > 599) {
      errors.push('response_status 必须是 100~599 的整数');
    }
  }
  if (!partial || payload.response_body !== undefined) {
    if (payload.response_body === undefined || payload.response_body === null) {
      errors.push('response_body 必填');
    } else {
      try {
        JSON.parse(normalizeBody(payload.response_body));
      } catch (e) {
        errors.push('response_body 必须是合法 JSON 字符串');
      }
    }
  }
  if (!partial || payload.error_format !== undefined) {
    if (payload.error_format === undefined || payload.error_format === null) {
      errors.push('error_format 必填');
    } else {
      try {
        JSON.parse(normalizeBody(payload.error_format));
      } catch (e) {
        errors.push('error_format 必须是合法 JSON 字符串');
      }
    }
  }
  if (payload.params !== undefined && !Array.isArray(payload.params)) {
    errors.push('params 必须是数组');
  }
  if (payload.headers !== undefined && !Array.isArray(payload.headers)) {
    errors.push('headers 必须是数组');
  }
  if (Array.isArray(payload.params)) {
    errors.push(...validateTree(payload.params, { topLevel: true }));
  }
  if (Array.isArray(payload.headers)) {
    payload.headers.forEach((h, i) => {
      if (!h.name) errors.push(`headers[${i}].name 必填`);
    });
  }
  return errors;
}

function rowToParam(row) {
  return {
    id: row.id,
    parent_id: row.parent_id,
    name: row.name,
    location: row.location,
    type: row.type,
    required: !!row.required,
    min_length: row.min_length,
    max_length: row.max_length,
    min_value: row.min_value,
    max_value: row.max_value,
    pattern: row.pattern,
    description: row.description,
    order_index: row.order_index
  };
}

function buildParamTree(rows) {
  const byId = new Map();
  const roots = [];
  for (const r of rows) {
    const node = rowToParam(r);
    node.children = [];
    byId.set(node.id, node);
  }
  for (const node of byId.values()) {
    if (node.parent_id != null && byId.has(node.parent_id)) {
      byId.get(node.parent_id).children.push(node);
    } else {
      roots.push(node);
    }
  }
  for (const node of byId.values()) {
    if (node.children.length === 0) delete node.children;
  }
  return roots;
}

function loadChildren(configId) {
  const params = db.prepare('SELECT * FROM api_params WHERE config_id = ? ORDER BY parent_id, order_index, id').all(configId);
  const headers = db.prepare('SELECT * FROM api_headers WHERE config_id = ? ORDER BY id ASC').all(configId);
  return {
    params: buildParamTree(params),
    headers: headers.map((h) => ({
      id: h.id,
      name: h.name,
      required: !!h.required,
      pattern: h.pattern
    }))
  };
}

function listConfigs() {
  const rows = db.prepare('SELECT * FROM api_configs ORDER BY id DESC').all();
  const counts = db.prepare(`
    SELECT config_id,
           SUM(CASE WHEN source='param' THEN 1 ELSE 0 END) AS param_count,
           SUM(CASE WHEN source='header' THEN 1 ELSE 0 END) AS header_count
    FROM (
      SELECT config_id, 'param' AS source FROM api_params
      UNION ALL
      SELECT config_id, 'header' AS source FROM api_headers
    )
    GROUP BY config_id
  `).all();
  const map = new Map(counts.map((c) => [c.config_id, c]));
  return rows.map((r) => {
    const c = {
      id: r.id,
      name: r.name,
      path: r.path,
      method: r.method,
      content_type: r.content_type,
      response_status: r.response_status,
      response_body: r.response_body,
      error_format: r.error_format,
      description: r.description,
      created_at: r.created_at,
      updated_at: r.updated_at
    };
    const m = map.get(r.id);
    c.param_count = m ? Number(m.param_count) : 0;
    c.header_count = m ? Number(m.header_count) : 0;
    return c;
  });
}

function getConfig(id) {
  const row = db.prepare('SELECT * FROM api_configs WHERE id = ?').get(id);
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    path: row.path,
    method: row.method,
    content_type: row.content_type,
    response_status: row.response_status,
    response_body: row.response_body,
    error_format: row.error_format,
    description: row.description,
    created_at: row.created_at,
    updated_at: row.updated_at,
    ...loadChildren(id)
  };
}

function getConfigByPath(method, path) {
  const row = db.prepare('SELECT * FROM api_configs WHERE method = ? AND path = ?').get(method.toUpperCase(), path);
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    path: row.path,
    method: row.method,
    content_type: row.content_type,
    response_status: row.response_status,
    response_body: row.response_body,
    error_format: row.error_format,
    description: row.description,
    created_at: row.created_at,
    updated_at: row.updated_at,
    ...loadChildren(row.id)
  };
}

function insertParamRecursive(configId, p, parentId, orderIndex) {
  const stmt = db.prepare(`
    INSERT INTO api_params
      (config_id, parent_id, name, location, type, required, min_length, max_length, min_value, max_value, pattern, description, order_index)
    VALUES
      (@config_id, @parent_id, @name, @location, @type, @required, @min_length, @max_length, @min_value, @max_value, @pattern, @description, @order_index)
  `);
  const info = stmt.run({
    config_id: configId,
    parent_id: parentId,
    name: p.name,
    location: p.location || null,
    type: p.type,
    required: p.required ? 1 : 0,
    min_length: p.min_length ?? null,
    max_length: p.max_length ?? null,
    min_value: p.min_value ?? null,
    max_value: p.max_value ?? null,
    pattern: p.pattern || null,
    description: p.description || null,
    order_index: orderIndex
  });
  const newId = info.lastInsertRowid;
  if (Array.isArray(p.children) && p.children.length && (p.type === 'object' || p.type === 'array')) {
    p.children.forEach((child, i) => insertParamRecursive(configId, child, newId, i));
  }
}

function insertHeaders(configId, headers) {
  const stmt = db.prepare(`
    INSERT INTO api_headers (config_id, name, required, pattern)
    VALUES (@config_id, @name, @required, @pattern)
  `);
  for (const h of headers) {
    stmt.run({
      config_id: configId,
      name: h.name,
      required: h.required ? 1 : 0,
      pattern: h.pattern || null
    });
  }
}

function createConfig(payload) {
  const errors = validateConfigPayload(payload, { partial: false });
  if (errors.length) {
    const err = new Error(errors.join('; '));
    err.statusCode = 400;
    throw err;
  }
  const now = nowIso();
  const tx = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO api_configs (name, path, method, content_type, response_status, response_body, error_format, description, created_at, updated_at)
      VALUES (@name, @path, @method, @content_type, @response_status, @response_body, @error_format, @description, @now, @now)
    `).run({
      name: payload.name,
      path: payload.path,
      method: String(payload.method).toUpperCase(),
      content_type: payload.content_type || 'application/json; charset=utf-8',
      response_status: payload.response_status ? Number(payload.response_status) : 200,
      response_body: normalizeBody(payload.response_body),
      error_format: normalizeBody(payload.error_format),
      description: payload.description || null,
      now
    });
    const id = info.lastInsertRowid;
    if (Array.isArray(payload.params) && payload.params.length) {
      payload.params.forEach((p, i) => insertParamRecursive(id, p, null, i));
    }
    if (Array.isArray(payload.headers) && payload.headers.length) insertHeaders(id, payload.headers);
    return id;
  });
  const id = tx();
  return getConfig(id);
}

function updateConfig(id, payload) {
  const existing = db.prepare('SELECT * FROM api_configs WHERE id = ?').get(id);
  if (!existing) {
    const err = new Error('配置不存在');
    err.statusCode = 404;
    throw err;
  }
  const errors = validateConfigPayload(
    {
      name: payload.name ?? existing.name,
      path: payload.path ?? existing.path,
      method: payload.method ?? existing.method,
      response_status: payload.response_status ?? existing.response_status,
      response_body: payload.response_body ?? existing.response_body,
      error_format: payload.error_format ?? existing.error_format,
      params: payload.params,
      headers: payload.headers
    },
    { partial: true }
  );
  if (errors.length) {
    const err = new Error(errors.join('; '));
    err.statusCode = 400;
    throw err;
  }
  const now = nowIso();
  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE api_configs
      SET name=@name, path=@path, method=@method, content_type=@content_type,
          response_status=@response_status, response_body=@response_body, error_format=@error_format,
          description=@description, updated_at=@now
      WHERE id=@id
    `).run({
      id,
      name: payload.name ?? existing.name,
      path: payload.path ?? existing.path,
      method: payload.method ? String(payload.method).toUpperCase() : existing.method,
      content_type: payload.content_type ?? existing.content_type,
      response_status: payload.response_status !== undefined ? Number(payload.response_status) : existing.response_status,
      response_body: payload.response_body !== undefined ? normalizeBody(payload.response_body) : existing.response_body,
      error_format: payload.error_format !== undefined ? normalizeBody(payload.error_format) : existing.error_format,
      description: payload.description !== undefined ? payload.description : existing.description,
      now
    });
    if (Array.isArray(payload.params)) {
      db.prepare('DELETE FROM api_params WHERE config_id = ?').run(id);
      if (payload.params.length) {
        payload.params.forEach((p, i) => insertParamRecursive(id, p, null, i));
      }
    }
    if (Array.isArray(payload.headers)) {
      db.prepare('DELETE FROM api_headers WHERE config_id = ?').run(id);
      if (payload.headers.length) insertHeaders(id, payload.headers);
    }
  });
  tx();
  return getConfig(id);
}

function deleteConfig(id) {
  const info = db.prepare('DELETE FROM api_configs WHERE id = ?').run(id);
  return info.changes > 0;
}

module.exports = {
  listConfigs,
  getConfig,
  getConfigByPath,
  createConfig,
  updateConfig,
  deleteConfig,
  validateConfigPayload
};
