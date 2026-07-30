'use strict';

const path = require('path');
const fs = require('fs');
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
  await runMarkitdown(keptOriginal, mdPath);

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
  getExt,
  deleteFile,
  mountFileToConfig,
  unmountFileFromConfig,
  listConfigsForFile,
  DATA_DIR,
  UPLOAD_DIR,
  MD_DIR
};
