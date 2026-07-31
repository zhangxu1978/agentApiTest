'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');
const multer = require('multer');
const fileService = require('../fileService');
const configService = require('../configService');

const router = express.Router();

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, fileService.UPLOAD_DIR),
    filename: (req, file, cb) => {
      // 临时文件名：仅用于 multer 落盘，最终文件名由 fileService.ingestFromPath 生成
      // 避免 multer 与 fileService 各自生成一份带时间戳的文件，导致 uploads 出现两份
      const stamp = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
      cb(null, `_tmp_${stamp}${path.extname(file.originalname || '')}`);
    }
  }),
  limits: { fileSize: 50 * 1024 * 1024 }
});

router.get('/', (req, res) => {
  res.json({ ok: true, data: fileService.listFiles() });
});

router.get('/:id', (req, res) => {
  const file = fileService.getFile(req.params.id);
  if (!file) return res.status(404).json({ ok: false, message: '文件不存在' });
  res.json({ ok: true, data: file });
});

router.get('/:id/preview', (req, res) => {
  const file = fileService.getFile(req.params.id);
  if (!file) return res.status(404).json({ ok: false, message: '文件不存在' });
  // 文本类文件直接返回原文；其余返回已转换的 Markdown
  const direct = fileService.canDirectPreview(file);
  const isImage = fileService.isImageFile(file);
  const body = direct ? fileService.readOriginal(file) : fileService.readMd(file.md_path);
  const ext = fileService.getExt(file.original_name) || fileService.getExt(file.name);
  let previewKind;
  if (isImage) previewKind = 'image';
  else if (direct) previewKind = (ext === 'html' || ext === 'htm') ? 'html' : ((ext === 'md' || ext === 'markdown') ? 'markdown' : 'text');
  else previewKind = 'markdown';
  res.json({
    ok: true,
    data: {
      id: file.id,
      name: file.name,
      original_name: file.original_name,
      ext,
      // markdown | text | html | image
      preview_kind: previewKind,
      preview_content: body,
      // 图片文件额外附带原始下载 URL，方便预览弹窗展示图片本身
      preview_url: isImage ? `/files/${file.id}/download` : undefined,
      md_content: fileService.readMd(file.md_path),
      size: body.length
    }
  });
});

router.get('/:id/download', (req, res) => {
  const file = fileService.getFile(req.params.id);
  if (!file) return res.status(404).json({ ok: false, message: '文件不存在' });
  res.download(file.original_path, file.original_name);
});

router.post('/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, message: '未上传文件' });
  // multer 默认按 latin1 解码 multipart 中的 filename 字段，导致中文文件名变成乱码
  // 浏览器实际发送的是 UTF-8 字节序列，这里转回 UTF-8 即可还原
  const originalName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
  try {
    const file = await fileService.ingestFromPath(req.file.path, originalName, 'upload', req.body.description || '');
    res.json({ ok: true, data: file });
  } catch (e) {
    console.error('[files] 上传失败:', e);
    res.status(e.statusCode || 500).json({ ok: false, message: e.message });
  }
});

router.post('/paste', async (req, res) => {
  const { name, content, description } = req.body || {};
  if (!content || !String(content).trim()) {
    return res.status(400).json({ ok: false, message: '内容不能为空' });
  }
  try {
    const file = await fileService.ingestTextContent(content, name || 'pasted.txt', description || '');
    res.json({ ok: true, data: file });
  } catch (e) {
    console.error('[files] 粘贴上传失败:', e);
    res.status(e.statusCode || 500).json({ ok: false, message: e.message });
  }
});

router.delete('/:id', (req, res) => {
  try {
    const ok = fileService.deleteFile(req.params.id);
    if (!ok) return res.status(404).json({ ok: false, message: '文件不存在' });
    res.json({ ok: true });
  } catch (e) {
    res.status(e.statusCode || 500).json({ ok: false, message: e.message });
  }
});

router.get('/:id/configs', (req, res) => {
  const file = fileService.getFile(req.params.id);
  if (!file) return res.status(404).json({ ok: false, message: '文件不存在' });
  res.json({ ok: true, data: fileService.listConfigsForFile(file.id) });
});

router.post('/:id/mount', (req, res) => {
  const { configId } = req.body || {};
  if (!configId) return res.status(400).json({ ok: false, message: '缺少 configId' });
  try {
    const cfg = fileService.mountFileToConfig(req.params.id, configId);
    res.json({ ok: true, data: cfg });
  } catch (e) {
    res.status(e.statusCode || 500).json({ ok: false, message: e.message });
  }
});

router.post('/:id/unmount', (req, res) => {
  const { configId } = req.body || {};
  if (!configId) return res.status(400).json({ ok: false, message: '缺少 configId' });
  try {
    const cfg = fileService.unmountFileFromConfig(configId);
    res.json({ ok: true, data: cfg });
  } catch (e) {
    res.status(e.statusCode || 500).json({ ok: false, message: e.message });
  }
});

router.get('/meta/all-configs', (req, res) => {
  res.json({ ok: true, data: configService.listConfigs().map((c) => ({ id: c.id, name: c.name, path: c.path, method: c.method, source_file_id: c.source_file_id })) });
});

module.exports = router;
