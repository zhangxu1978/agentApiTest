'use strict';

/**
 * 对外公开的"上传文件 → 返回 Markdown"接口
 *
 * 设计目的：
 *   - 其他系统直接调用本接口上传 docx/pdf/图片/文本文档，无需走本系统的 UI 与后台管理
 *   - 不写入数据库，转换完即返，不留痕
 *
 * 转换规则（与 fileService.ingestFromPath 保持一致）：
 *   - txt / md / json / csv / html / xml / yaml / log 等 → 原样返回（不做转换）
 *   - docx / pdf / pptx / xlsx 等 office 文档 → 本地 markitdown 转 md
 *   - png / jpg / jpeg / gif / bmp / webp / svg 等图片 → 走 FILE_IMAGE_UPLOAD_URL 上传代理 → minimax 多模态识别生成 md
 */

const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const dns = require('dns');
const express = require('express');
const fileService = require('../fileService');

const router = express.Router();

const MAX_SIZE = 50 * 1024 * 1024;
const HTTP_TIMEOUT = 60_000;
const HTTP_MAX_REDIRECTS = 5;
const ALLOWED_DIRS = (process.env.CONVERT_ALLOWED_DIRS || '').split(';').map(s => s.trim()).filter(Boolean);
const BLOCK_PRIVATE_IP = String(process.env.CONVERT_BLOCK_PRIVATE_IP ?? 'true').toLowerCase() !== 'false';

function decodeBase64(input) {
  const m = /^data:[^;]+;base64,(.+)$/i.exec(String(input || '').trim());
  const raw = m ? m[1] : input;
  if (typeof raw !== 'string' || !raw) {
    throw Object.assign(new Error('contentBase64 不能为空'), { statusCode: 400 });
  }
  return Buffer.from(raw, 'base64');
}

function isPrivateIp(host) {
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(host)) {
    const p = host.split('.').map(Number);
    if (p[0] === 10 || p[0] === 127 || p[0] === 0) return true;
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
    if (p[0] === 192 && p[1] === 168) return true;
    if (p[0] === 169 && p[1] === 254) return true;
    return false;
  }
  return false;
}

function resolveAndCheckHost(host) {
  return new Promise((resolve, reject) => {
    dns.lookup(host, { all: true }, (err, addresses) => {
      if (err) return reject(Object.assign(new Error('DNS 解析失败: ' + host), { statusCode: 400 }));
      for (const a of addresses) {
        if (a && a.address && BLOCK_PRIVATE_IP && isPrivateIp(a.address)) {
          return reject(Object.assign(new Error('禁止访问内网/保留 IP: ' + a.address), { statusCode: 400 }));
        }
      }
      resolve(addresses[0].address);
    });
  });
}

function _downloadOnce(targetUrl) {
  return new Promise(async (resolve, reject) => {
    let url;
    try { url = new URL(targetUrl); } catch (e) {
      return reject(Object.assign(new Error('fileUrl 格式非法: ' + e.message), { statusCode: 400 }));
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return reject(Object.assign(new Error('fileUrl 仅支持 http(s) 协议'), { statusCode: 400 }));
    }
    try { await resolveAndCheckHost(url.hostname); } catch (e) { return reject(e); }
    const protocol = url.protocol === 'https:' ? https : http;
    const req = protocol.request({
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: 'GET',
      protocol: url.protocol,
      headers: { 'User-Agent': 'agent-api-test-convert/1.0' }
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.destroy();
        return resolve({ redirectTo: new URL(res.headers.location, targetUrl).href });
      }
      if (res.statusCode >= 400) {
        let raw = '';
        res.on('data', (c) => { raw += c; });
        res.on('end', () => reject(Object.assign(
          new Error('下载失败 (HTTP ' + res.statusCode + '): ' + raw.slice(0, 500)),
          { statusCode: 400 }
        )));
        return;
      }
      const chunks = [];
      let total = 0;
      res.on('data', (c) => {
        total += c.length;
        if (total > MAX_SIZE) {
          req.destroy();
          return reject(Object.assign(new Error('文件超过 ' + MAX_SIZE + ' 字节上限'), { statusCode: 413 }));
        }
        chunks.push(c);
      });
      res.on('end', () => resolve({ buffer: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(HTTP_TIMEOUT, () => req.destroy(Object.assign(new Error('下载超时'), { statusCode: 504 })));
    req.end();
  });
}

async function downloadHttp(targetUrl) {
  const visited = new Set();
  let current = targetUrl;
  for (let i = 0; i < HTTP_MAX_REDIRECTS; i++) {
    if (visited.has(current)) throw Object.assign(new Error('检测到循环重定向'), { statusCode: 400 });
    visited.add(current);
    const result = await _downloadOnce(current);
    if (result.redirectTo) { current = result.redirectTo; continue; }
    return result.buffer;
  }
  throw Object.assign(new Error('超过最大重定向次数'), { statusCode: 400 });
}

function readLocalFile(filePath) {
  const normalized = path.resolve(String(filePath || '').trim());
  if (!normalized) throw Object.assign(new Error('filePath 不能为空'), { statusCode: 400 });
  if (normalized.includes('\\0')) throw Object.assign(new Error('非法路径'), { statusCode: 400 });
  if (ALLOWED_DIRS.length > 0) {
    const ok = ALLOWED_DIRS.some(allowed => {
      const a = path.resolve(allowed);
      return normalized === a || normalized.startsWith(a + path.sep);
    });
    if (!ok) throw Object.assign(new Error('路径不在允许目录内'), { statusCode: 400 });
  }
  if (!fs.existsSync(normalized)) throw Object.assign(new Error('文件不存在: ' + normalized), { statusCode: 404 });
  const stat = fs.statSync(normalized);
  if (!stat.isFile()) throw Object.assign(new Error('仅支持普通文件'), { statusCode: 400 });
  if (stat.size === 0) throw Object.assign(new Error('文件内容为空'), { statusCode: 400 });
  if (stat.size > MAX_SIZE) throw Object.assign(new Error('文件超过 ' + MAX_SIZE + ' 字节上限'), { statusCode: 413 });
  return { buffer: fs.readFileSync(normalized), resolvedPath: normalized };
}

function inferFilename(input) {
  if (!input) return '';
  try {
    const u = new URL(String(input));
    const base = path.basename(decodeURIComponent(u.pathname));
    if (base && base !== '/' && !base.endsWith('/')) return base;
  } catch (e) { /* not URL */ }
  const base = path.basename(String(input).trim().replace(/[?#].*$/, ''));
  return base || '';
}

router.post('/', express.json({ limit: '60mb' }), async (req, res) => {
  try {
    const { filename, contentBase64, fileUrl, filePath, mimeType } = req.body || {};
    const hasBase64 = !!contentBase64;
    const hasUrl = !!fileUrl;
    const hasPath = !!filePath;
    if (!hasBase64 && !hasUrl && !hasPath) {
      return res.status(400).json({ ok: false, message: '必须提供 contentBase64 / fileUrl / filePath 三者之一' });
    }
    const provided = [hasBase64, hasUrl, hasPath].filter(Boolean).length;
    if (provided > 1) {
      return res.status(400).json({ ok: false, message: 'contentBase64 / fileUrl / filePath 只能三选一' });
    }
    let buffer, sourceLabel, resolvedFileName = filename || '';
    if (hasBase64) {
      buffer = decodeBase64(contentBase64);
      sourceLabel = 'contentBase64';
      if (!resolvedFileName) return res.status(400).json({ ok: false, message: '通过 contentBase64 调用时必须提供 filename' });
    } else if (hasUrl) {
      buffer = await downloadHttp(fileUrl);
      sourceLabel = 'fileUrl';
      if (!resolvedFileName) resolvedFileName = inferFilename(fileUrl);
    } else {
      const local = readLocalFile(filePath);
      buffer = local.buffer;
      sourceLabel = 'filePath';
      if (!resolvedFileName) resolvedFileName = path.basename(local.resolvedPath);
    }
    if (!resolvedFileName) return res.status(400).json({ ok: false, message: '无法推断 filename，请显式提供' });
    if (buffer.length === 0) return res.status(400).json({ ok: false, message: '文件内容为空' });
    if (buffer.length > MAX_SIZE) return res.status(413).json({ ok: false, message: '文件超过 ' + MAX_SIZE + ' 字节上限' });
    const result = await fileService.convertBuffer(buffer, resolvedFileName);
    res.json({
      ok: true,
      data: {
        filename: resolvedFileName,
        mimeType: mimeType || '',
        size: buffer.length,
        input_source: sourceLabel,
        markdown: result.markdown,
        converted: result.converted,
        source: result.source,
        imageUrl: result.imageUrl || null
      }
    });
  } catch (e) {
    console.error('[convert] 失败:', e);
    res.status(e.statusCode || 500).json({ ok: false, message: e.message });
  }
});

router.get('/health', (req, res) => {
  res.json({
    ok: true,
    data: {
      service: 'convert',
      time: new Date().toISOString(),
      blockPrivateIp: BLOCK_PRIVATE_IP,
      allowedDirs: ALLOWED_DIRS.length > 0 ? ALLOWED_DIRS : 'unrestricted'
    }
  });
});

module.exports = router;
