'use strict';

const express = require('express');
const service = require('../configService');
const { validateRequest } = require('../validator');
const { sendSuccess, sendError, sendRawError } = require('../response');

const router = express.Router();

router.all('*', (req, res) => {
  const config = service.getConfigByPath(req.method, req.path);
  if (!config) {
    return sendRawError(res, 404, { code: 'NOT_FOUND', message: `API ${req.method} ${req.path} 不存在` });
  }
  const result = validateRequest(config, req);
  if (!result.ok) {
    const first = result.errors[0];
    return sendError(res, config, {
      code: first.code,
      message: first.message,
      field: first.field || ''
    });
  }
  return sendSuccess(res, config);
});

module.exports = router;
