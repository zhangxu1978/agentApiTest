'use strict';

function applyPlaceholders(formatObj, ctx) {
  if (formatObj === null || formatObj === undefined) return formatObj;
  if (typeof formatObj === 'string') {
    return formatObj
      .replace(/\{\{code\}\}/g, ctx.code == null ? '' : String(ctx.code))
      .replace(/\{\{message\}\}/g, ctx.message == null ? '' : String(ctx.message))
      .replace(/\{\{field\}\}/g, ctx.field == null ? '' : String(ctx.field));
  }
  if (Array.isArray(formatObj)) {
    return formatObj.map((v) => applyPlaceholders(v, ctx));
  }
  if (typeof formatObj === 'object') {
    const out = {};
    for (const k of Object.keys(formatObj)) {
      out[k] = applyPlaceholders(formatObj[k], ctx);
    }
    return out;
  }
  return formatObj;
}

function buildErrorBody(errorFormatStr, code, message, field) {
  let parsed;
  try {
    parsed = JSON.parse(errorFormatStr);
  } catch (e) {
    parsed = { code: -1, message: 'error_format 配置不合法' };
  }
  return applyPlaceholders(parsed, { code, message, field });
}

function sendSuccess(res, config) {
  let body;
  try {
    body = JSON.parse(config.response_body);
  } catch (e) {
    body = { raw: config.response_body };
  }
  res.setHeader('Content-Type', config.content_type || 'application/json; charset=utf-8');
  res.status(config.response_status || 200).send(JSON.stringify(body));
}

function sendError(res, config, { code, message, field }) {
  const body = buildErrorBody(config.error_format, code, message, field);
  res.setHeader('Content-Type', config.content_type || 'application/json; charset=utf-8');
  res.status(config.response_status || 200).send(JSON.stringify(body));
}

function sendRawError(res, status, body) {
  res.status(status).json(body);
}

module.exports = { sendSuccess, sendError, sendRawError, buildErrorBody };
