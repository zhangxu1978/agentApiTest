'use strict';

const db = require('./db');

function nowIso() {
  return new Date().toISOString();
}

function safeParse(text, fallback) {
  try {
    return JSON.parse(text);
  } catch (e) {
    return fallback;
  }
}

function createConversation({ title, fileIds = [] } = {}) {
  const now = nowIso();
  const finalTitle = (title && String(title).trim()) || '新对话';
  const info = db.prepare(`
    INSERT INTO agent_conversations (title, file_ids, created_at, updated_at)
    VALUES (?, ?, ?, ?)
  `).run(finalTitle, JSON.stringify(Array.isArray(fileIds) ? fileIds : []), now, now);
  return getConversation(info.lastInsertRowid);
}

function getConversation(id) {
  const row = db.prepare('SELECT * FROM agent_conversations WHERE id = ?').get(id);
  if (!row) return null;
  const messages = db.prepare(`
    SELECT role, content, tool_calls, seq
    FROM agent_messages
    WHERE conversation_id = ?
    ORDER BY seq ASC, id ASC
  `).all(id);
  return {
    id: row.id,
    title: row.title,
    fileIds: safeParse(row.file_ids, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    messages: messages.map((m) => ({
      role: m.role,
      content: m.content,
      toolCalls: safeParse(m.tool_calls, [])
    }))
  };
}

function listConversations() {
  const rows = db.prepare(`
    SELECT c.id, c.title, c.file_ids, c.created_at, c.updated_at,
           (SELECT COUNT(1) FROM agent_messages m WHERE m.conversation_id = c.id) AS message_count,
           (SELECT content FROM agent_messages m WHERE m.conversation_id = c.id AND m.role='user' ORDER BY seq ASC, id ASC LIMIT 1) AS preview
    FROM agent_conversations c
    ORDER BY c.updated_at DESC, c.id DESC
  `).all();
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    fileIds: safeParse(r.file_ids, []),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    messageCount: Number(r.message_count) || 0,
    preview: r.preview || ''
  }));
}

function renameConversation(id, title) {
  if (!title || !String(title).trim()) return false;
  const info = db.prepare(`
    UPDATE agent_conversations SET title = ?, updated_at = ? WHERE id = ?
  `).run(String(title).trim(), nowIso(), id);
  return info.changes > 0;
}

function touchConversation(id, fileIds) {
  const sets = ['updated_at = ?'];
  const params = [nowIso()];
  if (Array.isArray(fileIds)) {
    sets.push('file_ids = ?');
    params.push(JSON.stringify(fileIds));
  }
  params.push(id);
  db.prepare(`UPDATE agent_conversations SET ${sets.join(', ')} WHERE id = ?`).run(...params);
}

function appendMessage(conversationId, { role, content = '', toolCalls = [] }) {
  const maxRow = db.prepare(`
    SELECT COALESCE(MAX(seq), -1) AS s FROM agent_messages WHERE conversation_id = ?
  `).get(conversationId);
  const seq = (maxRow?.s ?? -1) + 1;
  db.prepare(`
    INSERT INTO agent_messages (conversation_id, role, content, tool_calls, seq, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    conversationId,
    role,
    content ?? '',
    JSON.stringify(Array.isArray(toolCalls) ? toolCalls : []),
    seq,
    nowIso()
  );
}

function deleteConversation(id) {
  const info = db.prepare('DELETE FROM agent_conversations WHERE id = ?').run(id);
  return info.changes > 0;
}

module.exports = {
  createConversation,
  getConversation,
  listConversations,
  renameConversation,
  touchConversation,
  appendMessage,
  deleteConversation
};
