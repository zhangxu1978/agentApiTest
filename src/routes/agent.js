'use strict';

const express = require('express');
const agentService = require('../agentService');

const router = express.Router();

router.post('/chat', async (req, res) => {
  try {
    const { messages } = req.body;
    if (!Array.isArray(messages)) {
      return res.status(400).json({ ok: false, message: 'messages 必须是数组' });
    }

    const response = await agentService.chat(messages);
    res.json({ ok: true, data: response });
  } catch (e) {
    console.error('[agent] 聊天错误:', e);
    res.status(500).json({ ok: false, message: e.message });
  }
});

router.get('/config', (req, res) => {
  res.json({ ok: true, data: agentService.getConfig() });
});

router.post('/config/reload', (req, res) => {
  try {
    const config = agentService.reloadConfig();
    res.json({ ok: true, data: config });
  } catch (e) {
    res.status(500).json({ ok: false, message: e.message });
  }
});

module.exports = router;
