'use strict';

const express = require('express');
const agentService = require('../agentService');

const router = express.Router();

router.post('/chat', async (req, res) => {
  try {
    const { messages, fileIds, conversationId, title } = req.body;
    if (!Array.isArray(messages)) {
      return res.status(400).json({ ok: false, message: 'messages 必须是数组' });
    }

    const validFileIds = Array.isArray(fileIds) ? fileIds.filter(x => x != null) : [];
    const response = await agentService.chat(messages, validFileIds, { conversationId, title });
    res.json({ ok: true, data: response });
  } catch (e) {
    console.error('[agent] 聊天错误:', e);
    res.status(500).json({ ok: false, message: e.message });
  }
});

// 外部 AI 接入入口：只用字符串消息，会话 ID 由外部控制
router.post('/external-chat', async (req, res) => {
  try {
    const { conversationId, message, fileIds, title } = req.body || {};
    if (typeof message !== 'string' || message.trim() === '') {
      return res.status(400).json({ ok: false, message: 'message 必须是字符串' });
    }

    const validFileIds = Array.isArray(fileIds) ? fileIds.filter(x => x != null) : [];
    // 不存在的 conversationId 视为"新对话"，由服务端创建并返回新的 id（外部以原 id 作为命名锚即可）
    const response = await agentService.externalChat({
      conversationId,
      message,
      fileIds: validFileIds,
      title
    });
    res.json({ ok: true, data: response });
  } catch (e) {
    console.error('[agent] 外部聊天错误:', e);
    const status = e.statusCode || 500;
    res.status(status).json({ ok: false, message: e.message });
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

// ===== 会话管理 =====
router.get('/conversations', (req, res) => {
  res.json({ ok: true, data: agentService.listConversations() });
});

router.post('/conversations', (req, res) => {
  try {
    const { title, fileIds } = req.body || {};
    const conv = agentService.createConversation({ title, fileIds });
    res.json({ ok: true, data: conv });
  } catch (e) {
    res.status(500).json({ ok: false, message: e.message });
  }
});

router.get('/conversations/:id', (req, res) => {
  const conv = agentService.getConversation(Number(req.params.id));
  if (!conv) return res.status(404).json({ ok: false, message: '会话不存在' });
  res.json({ ok: true, data: conv });
});

router.patch('/conversations/:id', (req, res) => {
  try {
    const { title } = req.body || {};
    const ok = agentService.renameConversation(Number(req.params.id), title);
    if (!ok) return res.status(400).json({ ok: false, message: '标题无效' });
    res.json({ ok: true, data: agentService.getConversation(Number(req.params.id)) });
  } catch (e) {
    res.status(500).json({ ok: false, message: e.message });
  }
});

router.delete('/conversations/:id', (req, res) => {
  const ok = agentService.deleteConversation(Number(req.params.id));
  if (!ok) return res.status(404).json({ ok: false, message: '会话不存在' });
  res.json({ ok: true });
});

module.exports = router;
