'use strict';

const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const { spawn } = require('child_process');
const db = require('./db');

const DATA_DIR = path.join(__dirname, '..', 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const MD_DIR = path.join(DATA_DIR, 'markdown');

for (const dir of [UPLOAD_DIR, MD_DIR]) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// 图片扩展名（无需走 markitdown，改为通过 minimax 多模态生成 md）
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg']);

// 上传代理地址：由用户提供，本服务负责把图片转发过去获取公网 URL（供 minimax 多模态消费）
// 可通过环境变量 FILE_IMAGE_UPLOAD_URL 覆盖，默认 http://127.0.0.1:3091/upload
const FILE_IMAGE_UPLOAD_URL = process.env.FILE_IMAGE_UPLOAD_URL || 'http://127.0.0.1:3091/upload';

function safeBaseName(name) {
  const ext = path.extname(name);
  const stem = path.basename(name, ext).replace(/[\\/:*?"<>|]/g, '_');
  const stamp = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  return {
    stem: `${stem}-${stamp}`,
    ext: ext.replace(/^\./, '').toLowerCase()
  };
}

function resolveMarkitdown() {
  return new Promise((resolve, reject) => {
    const cmd = process.platform === 'win32' ? 'markitdown.exe' : 'markitdown';
    const lookup = spawn(cmd, ['--version'], { shell: false });
    let resolved = false;
    lookup.on('error', () => {
      if (!resolved) {
        resolved = true;
        // fallback to PATH lookup via shell (cross-platform)
        const sh = process.platform === 'win32' ? 'where' : 'which';
        const fallback = spawn(sh, [cmd], { shell: true });
        let out = '';
        fallback.stdout.on('data', (c) => { out += c.toString(); });
        fallback.stderr.on('data', (c) => { out += c.toString(); });
        fallback.on('close', (code) => {
          const exe = out.split(/\r?\n/).map(s => s.trim()).filter(Boolean)[0];
          if (exe) resolve(exe);
          else reject(new Error('找不到 markitdown 可执行文件，请确认已安装并加入 PATH'));
        });
      }
    });
    lookup.on('close', () => {
      if (!resolved) {
        resolved = true;
        resolve(cmd);
      }
    });
  });
}

let cachedMarkitdownPath = null;
async function getMarkitdownPath() {
  if (cachedMarkitdownPath) return cachedMarkitdownPath;
  const exe = await resolveMarkitdown();
  cachedMarkitdownPath = exe;
  return exe;
}

function runMarkitdown(inputPath, outputPath) {
  return new Promise(async (resolve, reject) => {
    let exe;
    try {
      exe = await getMarkitdownPath();
    } catch (e) {
      return reject(e);
    }
    const isWin = process.platform === 'win32';
    const args = [inputPath, '-o', outputPath];
    const child = isWin
      ? spawn(exe, args, { shell: false })
      : spawn(exe, args, { shell: false });
    let stderr = '';
    child.stdout.on('data', (c) => { stderr += c.toString(); });
    child.stderr.on('data', (c) => { stderr += c.toString(); });
    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      if (code === 0 && fs.existsSync(outputPath)) resolve();
      else reject(new Error(`markitdown 转换失败 (exit ${code}): ${stderr.trim() || '无输出'}`));
    });
  });
}

function isImageExt(ext) {
  return IMAGE_EXTS.has(String(ext || '').toLowerCase());
}

// 通用 HTTP 请求（multipart 上传或 JSON 调用）
function postMultipart(targetUrl, filePath, originalName) {
  return new Promise((resolve, reject) => {
    let url;
    try { url = new URL(targetUrl); } catch (e) { return reject(new Error('FILE_IMAGE_UPLOAD_URL 配置非法: ' + e.message)); }
    const boundary = '----fileService' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const filename = originalName || path.basename(filePath);
    const fileData = fs.readFileSync(filePath);
    const head = Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: application/octet-stream\r\n\r\n`,
      'utf-8'
    );
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf-8');
    const body = Buffer.concat([head, fileData, tail]);
    const protocol = url.protocol === 'https:' ? https : http;
    const req = protocol.request({
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: 'POST',
      protocol: url.protocol,
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length
      }
    }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        let parsed = raw;
        try { parsed = JSON.parse(raw); } catch (e) { /* keep raw */ }
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(parsed);
        } else {
          reject(new Error(`图片上传代理失败 (HTTP ${res.statusCode}): ${typeof parsed === 'string' ? parsed.slice(0, 500) : JSON.stringify(parsed).slice(0, 500)}`));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(60000, () => req.destroy(new Error('图片上传代理超时')));
    req.write(body);
    req.end();
  });
}

function pickImageUrl(obj) {
  if (!obj) return null;
  if (typeof obj === 'string') return obj;
  // 常见返回字段
  const candidates = ['url', 'image_url', 'imageUrl', 'src', 'link', 'data.url'];
  for (const key of candidates) {
    if (key.indexOf('.') >= 0) {
      const parts = key.split('.');
      let cur = obj;
      for (const p of parts) cur = cur && cur[p];
      if (typeof cur === 'string') return cur;
    } else if (typeof obj[key] === 'string') {
      return obj[key];
    }
  }
  // 兜底：在对象/数组里递归找一个 http(s) 字符串
  const seen = new Set();
  function walk(v) {
    if (!v || seen.has(v)) return null;
    seen.add(v);
    if (typeof v === 'string') return /^https?:\/\//i.test(v) ? v : null;
    if (Array.isArray(v)) { for (const it of v) { const r = walk(it); if (r) return r; } }
    if (typeof v === 'object') { for (const k of Object.keys(v)) { const r = walk(v[k]); if (r) return r; } }
    return null;
  }
  return walk(obj);
}

async function uploadImageToProxy(localPath, originalName) {
  // 兼容两种返回：纯字符串 URL 或 JSON 对象
  const result = await postMultipart(FILE_IMAGE_UPLOAD_URL, localPath, originalName);
  const url = pickImageUrl(result);
  if (!url) {
    throw new Error(`图片上传成功但未在响应中找到 URL: ${typeof result === 'string' ? result.slice(0, 300) : JSON.stringify(result).slice(0, 300)}`);
  }
  return url;
}

function postJson(targetUrl, body, headers) {
  return new Promise((resolve, reject) => {
    let url;
    try { url = new URL(targetUrl); } catch (e) { return reject(new Error('baseUrl 非法: ' + e.message)); }
    const data = Buffer.from(JSON.stringify(body), 'utf-8');
    const protocol = url.protocol === 'https:' ? https : http;
    const req = protocol.request({
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: 'POST',
      protocol: url.protocol,
      headers: Object.assign({
        'Content-Type': 'application/json',
        'Content-Length': data.length
      }, headers || {})
    }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        let parsed = raw;
        try { parsed = JSON.parse(raw); } catch (e) { /* keep raw */ }
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(parsed);
        else reject(new Error(`LLM 调用失败 (HTTP ${res.statusCode}): ${typeof parsed === 'string' ? parsed.slice(0, 500) : JSON.stringify(parsed).slice(0, 500)}`));
      });
    });
    req.on('error', reject);
    req.setTimeout(120000, () => req.destroy(new Error('LLM 调用超时')));
    req.write(data);
    req.end();
  });
}

// 通过 minimax 多模态分析图片，并让模型把图片内容整理成 Markdown 文本
async function analyzeImageWithMiniMax(imageUrl, originalName) {
  const configPath = path.join(__dirname, '..', 'config.json');
  let cfg = null;
  try {
    cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch (e) {
    throw new Error('读取 config.json 失败: ' + e.message);
  }
  const agent = (cfg && cfg.agent) || {};
  const apiKey = agent.apiKey;
  const model = agent.model || 'MiniMax-M3';
  const baseUrl = agent.baseUrl || 'https://api.minimaxi.com/v1';
  if (!apiKey) {
    throw new Error('请先在 config.json 中配置 minimax API Key');
  }
  const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const prompt = `请仔细观察下面这张图片（文件名：${originalName || 'image'}），识别其中所有可见的文字、表格、字段名及其语义关系，然后输出一段结构清晰的 **Markdown** 文档，要求如下：
1. 尽量保留原始层级（一级/二级标题、列表、表格、代码块等），便于后续作为接口文档解析。
2. 如果图片中包含接口文档（字段说明、请求/响应示例、错误码等），按字段列出参数表（名称、类型、是否必填、说明）。
3. 如果图片中存在表格，请用 Markdown 表格呈现。
4. 如果没有可识别的文字，仅输出：“（图片中未检测到文本内容：<简短的图像描述>）”。
5. 不要输出任何解释、寒暄或代码围栏之外的内容；只输出 Markdown 本身。`;
  const body = {
    model,
    temperature: 0.2,
    stream: false,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          {
            type: 'image_url',
            image_url: {
              url: imageUrl,
              detail: 'default'
            }
          }
        ]
      }
    ]
  };
  const res = await postJson(url, body, { Authorization: `Bearer ${apiKey}` });
  const content = res && res.choices && res.choices[0] && res.choices[0].message && res.choices[0].message.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('minimax 多模态响应为空或格式异常: ' + JSON.stringify(res).slice(0, 500));
  }
  return content;
}

// 图片流程：上传代理 → 拿 URL → minimax 多模态 → 写 markdown 文件
async function generateMdForImage(localPath, originalName, mdPath) {
  const imageUrl = await uploadImageToProxy(localPath, originalName);
  const md = await analyzeImageWithMiniMax(imageUrl, originalName);
  const header = `> 来源图片：\`${originalName}\`\n> 图片URL：\`${imageUrl}\`\n\n`;
  fs.writeFileSync(mdPath, header + md, 'utf-8');
  return { imageUrl, md };
}

function rowToFile(row) {
  if (!row) return null;
  let linkCount = 0;
  try {
    const r = db.prepare('SELECT COUNT(*) AS c FROM api_configs WHERE source_file_id = ?').get(row.id);
    linkCount = r ? r.c : 0;
  } catch (e) { linkCount = 0; }
  return {
    id: row.id,
    name: row.name,
    original_name: row.original_name,
    original_path: row.original_path,
    md_path: row.md_path,
    mime_type: row.mime_type,
    size_bytes: row.size_bytes,
    source: row.source,
    description: row.description,
    created_at: row.created_at,
    updated_at: row.updated_at,
    link_count: linkCount
  };
}

async function ingestFromPath(originalPath, originalName, source = 'upload', description = '') {
  const stat = fs.statSync(originalPath);
  const { stem, ext } = safeBaseName(originalName);
  const targetExt = ext || path.extname(originalPath).replace(/^\./, '').toLowerCase() || 'bin';
  const keptOriginal = path.join(UPLOAD_DIR, `${stem}.${targetExt}`);
  // 直接移动（重命名）multer 临时文件到目标位置，避免产生副本
  fs.renameSync(originalPath, keptOriginal);

  const mdPath = path.join(MD_DIR, `${stem}.md`);

  if (isImageExt(targetExt)) {
    // 图片：不再走 markitdown，而是转发到 FILE_IMAGE_UPLOAD_URL 拿到 url，再用 minimax 多模态生成 md
    await generateMdForImage(keptOriginal, originalName, mdPath);
  } else {
    await runMarkitdown(keptOriginal, mdPath);
  }

  const info = db.prepare(`
    INSERT INTO uploaded_files
      (name, original_name, original_path, md_path, mime_type, size_bytes, source, description)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    stem,
    originalName,
    keptOriginal,
    mdPath,
    '',
    stat.size,
    source,
    description || ''
  );

  return getFile(info.lastInsertRowid);
}

async function ingestTextContent(textContent, fileName = 'pasted.txt', description = '') {
  const safeName = fileName.endsWith('.txt') ? fileName : `${fileName}.txt`;
  const tmpPath = path.join(UPLOAD_DIR, `_tmp_${Date.now()}_${safeName}`);
  fs.writeFileSync(tmpPath, textContent, 'utf-8');
  try {
    return await ingestFromPath(tmpPath, safeName, 'paste', description);
  } finally {
    try { fs.unlinkSync(tmpPath); } catch (e) {}
  }
}

function getFile(id) {
  const row = db.prepare('SELECT * FROM uploaded_files WHERE id = ?').get(Number(id));
  return rowToFile(row);
}

function listFiles() {
  const rows = db.prepare('SELECT * FROM uploaded_files ORDER BY id DESC').all();
  return rows.map(rowToFile);
}

// 文本类文件（可直接预览原文，无需转 md）：txt / md / html / htm / json / csv
const DIRECT_PREVIEW_EXTS = new Set(['txt', 'md', 'markdown', 'html', 'htm', 'json', 'csv', 'log', 'xml', 'yaml', 'yml']);
function getExt(name) {
  if (!name) return '';
  const m = String(name).toLowerCase().match(/\.([^.]+)$/);
  return m ? m[1] : '';
}
function canDirectPreview(file) {
  if (!file) return false;
  return DIRECT_PREVIEW_EXTS.has(getExt(file.original_name) || getExt(file.name));
}
function isImageFile(file) {
  if (!file) return false;
  return isImageExt(getExt(file.original_name) || getExt(file.name));
}
function readOriginal(file) {
  if (!file || !file.original_path) return '';
  if (!fs.existsSync(file.original_path)) return '';
  return fs.readFileSync(file.original_path, 'utf-8');
}
function readMd(mdPath) {
  if (!fs.existsSync(mdPath)) return '';
  return fs.readFileSync(mdPath, 'utf-8');
}

function deleteFile(id) {
  const idNum = Number(id);
  const row = db.prepare('SELECT * FROM uploaded_files WHERE id = ?').get(idNum);
  if (!row) return false;
  const usage = db.prepare('SELECT COUNT(*) AS c FROM api_configs WHERE source_file_id = ?').get(idNum);
  if (usage && usage.c > 0) {
    const err = new Error(`该文件已被 ${usage.c} 个接口挂载，请先解绑再删除`);
    err.statusCode = 400;
    throw err;
  }
  for (const p of [row.original_path, row.md_path]) {
    try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch (e) {}
  }
  db.prepare('DELETE FROM uploaded_files WHERE id = ?').run(idNum);
  return true;
}

function mountFileToConfig(fileId, configId) {
  const fId = Number(fileId);
  const cId = Number(configId);
  const row = db.prepare('SELECT id FROM uploaded_files WHERE id = ?').get(fId);
  if (!row) throw Object.assign(new Error('文件不存在'), { statusCode: 404 });
  const cfg = db.prepare('SELECT id FROM api_configs WHERE id = ?').get(cId);
  if (!cfg) throw Object.assign(new Error('接口不存在'), { statusCode: 404 });
  db.prepare(`UPDATE api_configs SET source_file_id = ?, updated_at = datetime('now') WHERE id = ?`).run(fId, cId);
  return db.prepare('SELECT id, name, path, method, source_file_id FROM api_configs WHERE id = ?').get(cId);
}

function unmountFileFromConfig(configId) {
  const cId = Number(configId);
  const cfg = db.prepare('SELECT id, source_file_id FROM api_configs WHERE id = ?').get(cId);
  if (!cfg) throw Object.assign(new Error('接口不存在'), { statusCode: 404 });
  db.prepare(`UPDATE api_configs SET source_file_id = NULL, updated_at = datetime('now') WHERE id = ?`).run(cId);
  return { id: cId, source_file_id: null };
}

function listConfigsForFile(fileId) {
  const rows = db.prepare('SELECT id, name, path, method FROM api_configs WHERE source_file_id = ? ORDER BY id DESC').all(Number(fileId));
  return rows;
}

module.exports = {
  ingestFromPath,
  ingestTextContent,
  getFile,
  listFiles,
  readMd,
  readOriginal,
  canDirectPreview,
  isImageFile,
  getExt,
  uploadImageToProxy,
  analyzeImageWithMiniMax,
  generateMdForImage,
  deleteFile,
  mountFileToConfig,
  unmountFileFromConfig,
  listConfigsForFile,
  DATA_DIR,
  UPLOAD_DIR,
  MD_DIR
};
