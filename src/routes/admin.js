'use strict';

const express = require('express');
const service = require('../configService');
const logger = require('../logger');

const router = express.Router();

router.get('/logs', (req, res) => {
  const limit = Number(req.query.limit) || 100;
  const offset = Number(req.query.offset) || 0;
  res.json({ ok: true, data: logger.getLogs({ limit, offset }) });
});

router.delete('/logs', (req, res) => {
  logger.clearLogs();
  res.json({ ok: true });
});

router.get('/configs', (req, res) => {
  res.json({ ok: true, data: service.listConfigs() });
});

router.get('/configs/:id', (req, res) => {
  const id = Number(req.params.id);
  const data = service.getConfig(id);
  if (!data) return res.status(404).json({ ok: false, message: '配置不存在' });
  res.json({ ok: true, data });
});

router.post('/configs', (req, res) => {
  try {
    const data = service.createConfig(req.body || {});
    res.json({ ok: true, data });
  } catch (e) {
    res.status(e.statusCode || 500).json({ ok: false, message: e.message });
  }
});

router.put('/configs/:id', (req, res) => {
  const id = Number(req.params.id);
  try {
    const data = service.updateConfig(id, req.body || {});
    res.json({ ok: true, data });
  } catch (e) {
    res.status(e.statusCode || 500).json({ ok: false, message: e.message });
  }
});

router.delete('/configs/:id', (req, res) => {
  const id = Number(req.params.id);
  const ok = service.deleteConfig(id);
  if (!ok) return res.status(404).json({ ok: false, message: '配置不存在' });
  res.json({ ok: true });
});

module.exports = router;
