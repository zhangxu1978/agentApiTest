'use strict';

function getByLocation(req, location) {
  if (location === 'query') return req.query || {};
  if (location === 'body') return req.body && typeof req.body === 'object' ? req.body : {};
  if (location === 'path') return req.params || {};
  return {};
}

function typeMatches(raw, type) {
  switch (type) {
    case 'string':
      return typeof raw === 'string';
    case 'number':
      return typeof raw === 'number' && Number.isFinite(raw);
    case 'boolean':
      return typeof raw === 'boolean';
    case 'object':
      return raw !== null && typeof raw === 'object' && !Array.isArray(raw);
    case 'array':
      return Array.isArray(raw);
    default:
      return true;
  }
}

function isEmpty(value) {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string' && value === '') return true;
  if (Array.isArray(value) && value.length === 0) return true;
  if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0) return true;
  return false;
}

function validateHeaders(config, req) {
  const errors = [];
  for (const h of config.headers || []) {
    const raw = req.headers[h.name.toLowerCase()];
    if (isEmpty(raw)) {
      if (h.required) {
        errors.push({
          field: h.name,
          location: 'header',
          code: 'MISSING_HEADER',
          message: `${h.name} 请求头必填`
        });
      }
      continue;
    }
    if (h.pattern) {
      try {
        const re = new RegExp(h.pattern);
        if (!re.test(String(raw))) {
          errors.push({
            field: h.name,
            location: 'header',
            code: 'HEADER_PATTERN_MISMATCH',
            message: `${h.name} 格式不正确`
          });
        }
      } catch (e) {
        // ignore bad regex
      }
    }
  }
  return errors;
}

function validateNode(param, value, path, errors) {
  // path: dotted path from root
  if (value === undefined) {
    if (param.required) {
      errors.push({
        field: path,
        location: 'body',
        code: 'REQUIRED',
        message: `${path} 必填`
      });
    }
    return;
  }
  // value is present
  if (!typeMatches(value, param.type)) {
    errors.push({
      field: path,
      location: 'body',
      code: 'TYPE_ERROR',
      message: `${path} 类型应为 ${param.type}`
    });
    return;
  }

  if (param.type === 'string') {
    const len = value.length;
    if (param.min_length != null && len < param.min_length) {
      errors.push({
        field: path,
        location: 'body',
        code: 'TOO_SHORT',
        message: `${path} 长度不能小于 ${param.min_length}`
      });
      return;
    }
    if (param.max_length != null && len > param.max_length) {
      errors.push({
        field: path,
        location: 'body',
        code: 'TOO_LONG',
        message: `${path} 长度不能大于 ${param.max_length}`
      });
      return;
    }
  }

  if (param.type === 'number') {
    if (param.min_value != null && value < param.min_value) {
      errors.push({
        field: path,
        location: 'body',
        code: 'OUT_OF_RANGE',
        message: `${path} 不能小于 ${param.min_value}`
      });
      return;
    }
    if (param.max_value != null && value > param.max_value) {
      errors.push({
        field: path,
        location: 'body',
        code: 'OUT_OF_RANGE',
        message: `${path} 不能大于 ${param.max_value}`
      });
      return;
    }
  }

  if (param.type === 'object' && Array.isArray(param.children)) {
    for (const child of param.children) {
      const childPath = path + '.' + child.name;
      const childValue = value[child.name];
      validateNode(child, childValue, childPath, errors);
    }
  }

  if (param.type === 'array' && Array.isArray(param.children) && param.children.length > 0) {
    // array of object/array: validate each element against children
    for (let i = 0; i < value.length; i++) {
      const elem = value[i];
      if (elem === undefined) continue;
      // Each child describes the element schema, not an array index
      // We treat each child as applying to every element
      for (const child of param.children) {
        const childPath = `${path}[${i}].${child.name}`;
        validateNode(child, elem[child.name], childPath, errors);
      }
    }
  }

  if (param.pattern) {
    try {
      const re = new RegExp(param.pattern);
      if (!re.test(String(value))) {
        errors.push({
          field: path,
          location: 'body',
          code: 'PATTERN_MISMATCH',
          message: `${path} 格式不正确`
        });
      }
    } catch (e) {
      // ignore bad regex
    }
  }
}

function validateParamsTree(config, req) {
  const errors = [];
  const topParams = (config.params || []).filter((p) => !p.parent_id);
  for (const p of topParams) {
    if (p.location === 'query') {
      const source = req.query || {};
      const hasKey = Object.prototype.hasOwnProperty.call(source, p.name);
      const value = hasKey ? source[p.name] : undefined;
      validateNode(p, value, p.name, errors);
    } else if (p.location === 'body') {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const value = Object.prototype.hasOwnProperty.call(body, p.name) ? body[p.name] : undefined;
      validateNode(p, value, p.name, errors);
    } else if (p.location === 'path') {
      const source = req.params || {};
      const hasKey = Object.prototype.hasOwnProperty.call(source, p.name);
      const value = hasKey ? source[p.name] : undefined;
      validateNode(p, value, p.name, errors);
    }
  }
  return errors;
}

function validateRequest(config, req) {
  const errors = [];
  errors.push(...validateHeaders(config, req));
  errors.push(...validateParamsTree(config, req));
  return errors.length ? { ok: false, errors } : { ok: true };
}

module.exports = { validateRequest, validateParamsTree, validateNode };
