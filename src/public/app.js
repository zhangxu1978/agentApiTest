'use strict';

const API = {
  list:   () => fetch('/admin/api/configs').then((r) => r.json()),
  get:    (id) => fetch(`/admin/api/configs/${id}`).then((r) => r.json()),
  create: (data) => fetch('/admin/api/configs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then((r) => r.json()),
  update: (id, data) => fetch(`/admin/api/configs/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then((r) => r.json()),
  remove: (id) => fetch(`/admin/api/configs/${id}`, { method: 'DELETE' }).then((r) => r.json()),
  logs:   () => fetch('/admin/api/logs').then((r) => r.json()),
  clearLogs: () => fetch('/admin/api/logs', { method: 'DELETE' }).then((r) => r.json())
};

const state = {
  list: [],
  filter: '',
  selectedId: null,
  draft: null
};

const $ = (id) => document.getElementById(id);
const el = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'onclick') node.addEventListener('click', v);
    else if (k === 'onchange') node.addEventListener('change', v);
    else if (k === 'oninput') node.addEventListener('input', v);
    else if (k.startsWith('data-')) node.setAttribute(k, v);
    else if (v != null) node.setAttribute(k, v);
  }
  for (const c of children) {
    if (c == null) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
};

function toast(msg, type = 'ok') {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast ' + type;
  setTimeout(() => t.classList.add('hidden'), 2400);
}

async function refreshList() {
  const res = await API.list();
  if (res.ok) {
    state.list = res.data;
    renderList();
  } else {
    toast(res.message || '加载失败', 'err');
  }
}

function renderList() {
  const ul = $('api-list');
  ul.innerHTML = '';
  const filter = state.filter.trim().toLowerCase();
  const items = state.list.filter((c) => {
    if (!filter) return true;
    return (c.name || '').toLowerCase().includes(filter)
      || (c.path || '').toLowerCase().includes(filter);
  });
  $('list-count').textContent = items.length;
  for (const c of items) {
    const li = el('li', {
      class: state.selectedId === c.id ? 'active' : '',
      onclick: () => selectConfig(c.id)
    });
    li.appendChild(el('div', { class: 'row1' },
      el('span', { class: `method-badge method-${c.method}` }, c.method),
      el('span', { class: 'name' }, c.name),
      c.source_file_id ? el('span', { class: 'file-badge linked', title: '该接口由上传文件衍生' }, `📁 #${c.source_file_id}`) : null
    ));
    li.appendChild(el('div', { class: 'path' }, c.path));
    li.appendChild(el('div', { class: 'meta' }, `${c.param_count} 参数 · ${c.header_count} 头 · ${c.response_status}`));
    ul.appendChild(li);
  }
}

function makeBlankParam() {
  return {
    id: null,
    parent_id: null,
    name: '',
    location: 'body',
    type: 'string',
    required: false,
    min_length: null,
    max_length: null,
    min_value: null,
    max_value: null,
    pattern: '',
    description: '',
    children: []
  };
}

function emptyDraft() {
  return {
    id: null,
    name: '',
    path: '',
    method: 'POST',
    content_type: 'application/json; charset=utf-8',
    response_status: 200,
    response_body: '{\n  "code": 0,\n  "message": "ok",\n  "data": {}\n}',
    error_format: '{\n  "code": 1001,\n  "message": "{{message}}",\n  "field": "{{field}}"\n}',
    description: '',
    params: [],
    headers: []
  };
}

async function selectConfig(id) {
  const res = await API.get(id);
  if (!res.ok || !res.data) {
    toast(res.message || '加载配置失败', 'err');
    return;
  }
  const cfg = res.data;
  state.selectedId = id;
  state.draft = JSON.parse(JSON.stringify({
    id: cfg.id,
    name: cfg.name,
    path: cfg.path,
    method: cfg.method,
    content_type: cfg.content_type,
    response_status: cfg.response_status,
    response_body: cfg.response_body,
    error_format: cfg.error_format,
    description: cfg.description || '',
    params: ensureChildrenArray(cfg.params || []),
    headers: cfg.headers || []
  }));
  showEditor();
  renderList();
}

function loadDraftFromFullConfig(cfg) {
  state.selectedId = cfg.id;
  state.draft = JSON.parse(JSON.stringify({
    id: cfg.id,
    name: cfg.name,
    path: cfg.path,
    method: cfg.method,
    content_type: cfg.content_type,
    response_status: cfg.response_status,
    response_body: cfg.response_body,
    error_format: cfg.error_format,
    description: cfg.description || '',
    params: ensureChildrenArray(cfg.params || []),
    headers: cfg.headers || []
  }));
  showEditor();
  renderList();
}

function ensureChildrenArray(params) {
  for (const p of params) {
    if (!Array.isArray(p.children)) p.children = [];
    ensureChildrenArray(p.children);
  }
  return params;
}

function newConfig() {
  state.selectedId = null;
  state.draft = emptyDraft();
  showEditor();
  renderList();
}

function showEditor() {
  $('empty').classList.add('hidden');
  $('editor').classList.remove('hidden');
  const isNew = state.draft.id == null;
  $('editor-title').textContent = isNew ? '新建接口' : `编辑接口 #${state.draft.id}`;
  $('editor-subtitle').textContent = isNew ? '' : `创建于 ${state.list.find((c) => c.id === state.draft.id)?.created_at || ''}`;
  $('btn-delete').style.display = isNew ? 'none' : '';

  $('f-name').value = state.draft.name;
  $('f-method').value = state.draft.method;
  $('f-path').value = state.draft.path;
  $('f-content-type').value = state.draft.content_type;
  $('f-response-status').value = state.draft.response_status;
  $('f-description').value = state.draft.description;
  $('f-response-body').value = state.draft.response_body;
  $('f-error-format').value = state.draft.error_format;
  validateJsonArea('response-body');
  validateJsonArea('error-format');

  renderHeaderRows();
  renderParamRows();
}

function renderHeaderRows() {
  const tbody = $('header-table').querySelector('tbody');
  tbody.innerHTML = '';
  state.draft.headers.forEach((h, idx) => tbody.appendChild(headerRow(h, idx)));
}

function headerRow(h, idx) {
  const tr = el('tr');
  tr.appendChild(el('td', {}, el('input', {
    type: 'text', value: h.name || '',
    onchange: (e) => (state.draft.headers[idx].name = e.target.value)
  })));
  tr.appendChild(el('td', { class: 'center' }, el('input', {
    type: 'checkbox',
    onchange: (e) => (state.draft.headers[idx].required = e.target.checked),
    ...(h.required ? { checked: 'checked' } : {})
  })));
  tr.appendChild(el('td', {}, el('input', {
    type: 'text', value: h.pattern || '', placeholder: '可选正则',
    onchange: (e) => (state.draft.headers[idx].pattern = e.target.value)
  })));
  tr.appendChild(el('td', { class: 'center' }, el('button', {
    class: 'btn-mini btn', onclick: () => { state.draft.headers.splice(idx, 1); renderHeaderRows(); }
  }, '✕')));
  return tr;
}

function renderParamRows() {
  const tbody = $('param-table').querySelector('tbody');
  tbody.innerHTML = '';
  state.draft.params.forEach((p) => tbody.appendChild(paramRow(p, 0, false)));
}

function findParamByDraftRef(ref) {
  function dfs(list) {
    for (const p of list) {
      if (p === ref) return p;
      if (Array.isArray(p.children)) {
        const f = dfs(p.children);
        if (f) return f;
      }
    }
    return null;
  }
  return dfs(state.draft.params);
}

function removeParamDeep(list, ref) {
  for (let i = 0; i < list.length; i++) {
    if (list[i] === ref) {
      list.splice(i, 1);
      return true;
    }
    if (Array.isArray(list[i].children) && removeParamDeep(list[i].children, ref)) {
      return true;
    }
  }
  return false;
}

function paramRow(p, depth, isChild) {
  const tr = el('tr', { class: isChild ? 'is-child' : '' });

  // Name cell with indent
  const nameCell = el('td', { class: 'indent' });
  if (depth > 0) {
    const spacer = el('span', { class: 'indent-spacer' });
    spacer.style.width = (depth * 16) + 'px';
    nameCell.appendChild(spacer);
  }
  nameCell.appendChild(el('input', {
    type: 'text', value: p.name || '',
    placeholder: isChild ? '子项名' : '参数名',
    onchange: (e) => (p.name = e.target.value)
  }));
  if (p.type === 'object' || p.type === 'array') {
    nameCell.appendChild(el('span', { class: 'child-badge' }, p.type));
  }
  tr.appendChild(nameCell);

  // Location (only for top-level)
  if (!isChild) {
    tr.appendChild(el('td', {}, select(['query', 'body', 'path'], p.location, (v) => (p.location = v))));
  } else {
    const empty = el('td', {});
    empty.style.color = 'var(--muted)';
    empty.textContent = '↳ 嵌套';
    tr.appendChild(empty);
  }

  // Type
  tr.appendChild(el('td', {}, select(['string', 'number', 'boolean', 'object', 'array'], p.type, (v) => {
    p.type = v;
    if (v !== 'object' && v !== 'array') {
      p.children = [];
    } else if (!Array.isArray(p.children)) {
      p.children = [];
    }
    renderParamRows();
  })));

  // Required
  tr.appendChild(el('td', { class: 'center' }, el('input', {
    type: 'checkbox',
    onchange: (e) => (p.required = e.target.checked),
    ...(p.required ? { checked: 'checked' } : {})
  })));

  // Length / Range / Pattern / Description
  tr.appendChild(el('td', {}, el('input', {
    type: 'number', value: p.min_length ?? '', placeholder: '-',
    onchange: (e) => (p.min_length = numOrNull(e.target.value))
  })));
  tr.appendChild(el('td', {}, el('input', {
    type: 'number', value: p.max_length ?? '', placeholder: '-',
    onchange: (e) => (p.max_length = numOrNull(e.target.value))
  })));
  tr.appendChild(el('td', {}, el('input', {
    type: 'number', value: p.min_value ?? '', placeholder: '-',
    onchange: (e) => (p.min_value = numOrNull(e.target.value))
  })));
  tr.appendChild(el('td', {}, el('input', {
    type: 'number', value: p.max_value ?? '', placeholder: '-',
    onchange: (e) => (p.max_value = numOrNull(e.target.value))
  })));
  tr.appendChild(el('td', {}, el('input', {
    type: 'text', value: p.pattern || '', placeholder: '可选',
    onchange: (e) => (p.pattern = e.target.value)
  })));
  tr.appendChild(el('td', {}, el('input', {
    type: 'text', value: p.description || '', placeholder: '可选',
    onchange: (e) => (p.description = e.target.value)
  })));

  // Actions
  const actions = el('td', { class: 'row-actions' });
  if (p.type === 'object' || p.type === 'array') {
    actions.appendChild(el('button', {
      class: 'btn-mini btn btn-primary',
      onclick: () => {
        if (!Array.isArray(p.children)) p.children = [];
        p.children.push(makeBlankParam());
        p.children[p.children.length - 1].location = null;
        renderParamRows();
      }
    }, '+子项'));
  }
  actions.appendChild(el('button', {
    class: 'btn-mini btn btn-danger',
    onclick: () => {
      removeParamDeep(state.draft.params, p);
      renderParamRows();
    }
  }, '✕'));
  tr.appendChild(actions);

  // Append children rows
  const frag = document.createDocumentFragment();
  frag.appendChild(tr);
  if (Array.isArray(p.children)) {
    p.children.forEach((c) => {
      frag.appendChild(paramRow(c, depth + 1, true));
    });
  }
  return frag;
}

function select(options, value, onchange) {
  const s = el('select', { onchange: (e) => onchange(e.target.value) });
  for (const o of options) {
    const opt = el('option', { value: o }, o);
    if (o === value) opt.setAttribute('selected', 'selected');
    s.appendChild(opt);
  }
  return s;
}

function numOrNull(v) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

function collectDraft() {
  state.draft.name = $('f-name').value.trim();
  state.draft.path = $('f-path').value.trim();
  state.draft.method = $('f-method').value;
  state.draft.content_type = $('f-content-type').value.trim();
  state.draft.response_status = Number($('f-response-status').value);
  state.draft.description = $('f-description').value.trim();
  state.draft.response_body = $('f-response-body').value;
  state.draft.error_format = $('f-error-format').value;
}

function stripParamServerFields(p) {
  const out = {
    name: p.name,
    location: p.location,
    type: p.type,
    required: !!p.required,
    min_length: p.min_length,
    max_length: p.max_length,
    min_value: p.min_value,
    max_value: p.max_value,
    pattern: p.pattern || null,
    description: p.description || null
  };
  if (Array.isArray(p.children) && p.children.length && (p.type === 'object' || p.type === 'array')) {
    out.children = p.children.map(stripParamServerFields);
  }
  return out;
}

async function saveConfig() {
  collectDraft();
  const body = {
    name: state.draft.name,
    path: state.draft.path,
    method: state.draft.method,
    content_type: state.draft.content_type,
    response_status: state.draft.response_status,
    response_body: state.draft.response_body,
    error_format: state.draft.error_format,
    description: state.draft.description,
    params: state.draft.params.map(stripParamServerFields),
    headers: state.draft.headers
  };
  const res = state.draft.id == null ? await API.create(body) : await API.update(state.draft.id, body);
  if (res.ok) {
    toast('保存成功');
    await refreshList();
    if (res.data && res.data.id) {
      // Use the full config returned by save (contains nested params),
      // do NOT call selectConfig() which would re-fetch from the list cache.
      loadDraftFromFullConfig(res.data);
    }
  } else {
    toast(res.message || '保存失败', 'err');
  }
}

async function deleteConfig() {
  if (state.draft.id == null) return;
  if (!confirm(`确认删除「${state.draft.name}」？`)) return;
  const res = await API.remove(state.draft.id);
  if (res.ok) {
    toast('已删除');
    state.selectedId = null;
    state.draft = emptyDraft();
    $('editor').classList.add('hidden');
    $('empty').classList.remove('hidden');
    await refreshList();
  } else {
    toast(res.message || '删除失败', 'err');
  }
}

async function cancelEdit() {
  if (state.selectedId) {
    await selectConfig(state.selectedId);
  } else {
    state.draft = emptyDraft();
    $('editor').classList.add('hidden');
    $('empty').classList.remove('hidden');
  }
}

function validateJsonArea(name) {
  const ta = $('f-' + name);
  const status = $('f-' + name + '-status');
  try {
    JSON.parse(ta.value);
    status.textContent = 'JSON 合法';
    status.className = 'muted ok';
  } catch (e) {
    status.textContent = 'JSON 错误：' + e.message;
    status.className = 'muted err';
  }
}

function openTestModal() {
  $('test-result').classList.add('hidden');
  $('t-query').value = '{}';
  $('t-body').value = state.draft.method === 'GET' ? '{}' : '{}';
  $('t-headers').value = '{}';
  $('test-title').textContent = `测试调用 - ${state.draft.method} ${state.draft.path}`;
  $('test-modal').classList.remove('hidden');
}

function closeTestModal() {
  $('test-modal').classList.add('hidden');
}

async function doTest() {
  let query, body, headers;
  try {
    query = JSON.parse($('t-query').value || '{}');
    body = JSON.parse($('t-body').value || '{}');
    headers = JSON.parse($('t-headers').value || '{}');
  } catch (e) {
    toast('JSON 解析错误：' + e.message, 'err');
    return;
  }
  const path = state.draft.path;
  const queryStr = new URLSearchParams(query).toString();
  const url = location.origin + path + (queryStr ? '?' + queryStr : '');
  $('t-url').textContent = url;
  $('t-method').textContent = state.draft.method;
  $('t-resp-headers').textContent = '(调用后显示)';
  $('t-resp-body').textContent = '(调用后显示)';
  $('t-status').textContent = '(调用后显示)';

  try {
    const resp = await fetch(url, {
      method: state.draft.method,
      headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
      body: ['GET', 'DELETE'].includes(state.draft.method) ? undefined : JSON.stringify(body)
    });
    $('t-status').textContent = resp.status;
    const hdrs = {};
    resp.headers.forEach((v, k) => (hdrs[k] = v));
    $('t-resp-headers').textContent = JSON.stringify(hdrs, null, 2);
    const text = await resp.text();
    try { $('t-resp-body').textContent = JSON.stringify(JSON.parse(text), null, 2); }
    catch { $('t-resp-body').textContent = text; }
    $('test-result').classList.remove('hidden');
  } catch (e) {
    $('t-resp-body').textContent = '调用失败：' + e.message;
    $('test-result').classList.remove('hidden');
  }
}

function toggleLogs() {
  const sidebar = $('logs-sidebar');
  const isHidden = sidebar.classList.contains('hidden');
  sidebar.classList.toggle('hidden', !isHidden);
  if (isHidden) {
    refreshLogs();
  }
}

let logsData = [];

async function refreshLogs() {
  const res = await API.logs();
  if (res.ok) {
    logsData = res.data;
    renderLogs();
  } else {
    toast(res.message || '加载日志失败', 'err');
  }
}

function renderLogs() {
  const tbody = $('logs-body');
  tbody.innerHTML = '';
  const hasLogs = logsData.length > 0;
  $('logs-empty').classList.toggle('hidden', hasLogs);
  $('logs-list').classList.toggle('hidden', !hasLogs);
  for (const log of logsData) {
    const tr = el('tr', { onclick: () => showLogDetail(log) });
    const time = new Date(log.timestamp);
    tr.appendChild(el('td', {}, time.toLocaleString('zh-CN')));
    tr.appendChild(el('td', {}, el('span', { class: `method-badge method-${log.method}` }, log.method)));
    tr.appendChild(el('td', { style: 'font-family: monospace;' }, log.path));
    const hasQuery = Object.keys(log.query || {}).length > 0;
    const hasBody = Object.keys(log.body || {}).length > 0;
    const hasHeaders = Object.keys(log.headers || {}).length > 0;
    let detail = [];
    if (hasHeaders) detail.push(`${Object.keys(log.headers).length} headers`);
    if (hasQuery) detail.push('有 query');
    if (hasBody) detail.push('有 body');
    tr.appendChild(el('td', { class: 'muted' }, detail.length ? detail.join(' · ') : '无额外参数'));
    tbody.appendChild(tr);
  }
}

function showLogDetail(log) {
  const time = new Date(log.timestamp);
  $('log-time').textContent = time.toLocaleString('zh-CN');
  $('log-method').textContent = log.method;
  $('log-path').textContent = log.path;
  $('log-headers').textContent = JSON.stringify(log.headers || {}, null, 2);
  $('log-query').textContent = JSON.stringify(log.query || {}, null, 2);
  $('log-body').textContent = JSON.stringify(log.body || {}, null, 2);
  $('log-detail-modal').classList.remove('hidden');
}

function closeLogDetail() {
  $('log-detail-modal').classList.add('hidden');
}

async function clearLogs() {
  if (!confirm('确认清空所有日志？')) return;
  const res = await API.clearLogs();
  if (res.ok) {
    toast('日志已清空');
    logsData = [];
    renderLogs();
  } else {
    toast(res.message || '清空失败', 'err');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  $('search').addEventListener('input', (e) => { state.filter = e.target.value; renderList(); });
  $('btn-new').addEventListener('click', newConfig);
  $('btn-refresh').addEventListener('click', refreshList);
  $('btn-save').addEventListener('click', saveConfig);
  $('btn-delete').addEventListener('click', deleteConfig);
  $('btn-cancel').addEventListener('click', cancelEdit);
  $('btn-test').addEventListener('click', openTestModal);
  $('btn-close-test').addEventListener('click', closeTestModal);
  $('btn-do-test').addEventListener('click', doTest);
  $('btn-add-header').addEventListener('click', () => {
    state.draft.headers.push({ name: '', required: false, pattern: '' });
    renderHeaderRows();
  });
  $('btn-add-param').addEventListener('click', () => {
    state.draft.params.push(makeBlankParam());
    renderParamRows();
  });
  $('f-response-body').addEventListener('input', () => validateJsonArea('response-body'));
  $('f-error-format').addEventListener('input', () => validateJsonArea('error-format'));

  $('btn-toggle-logs').addEventListener('click', toggleLogs);
  $('btn-refresh-logs').addEventListener('click', refreshLogs);
  $('btn-clear-logs').addEventListener('click', clearLogs);
  $('btn-close-logs').addEventListener('click', toggleLogs);
  $('btn-close-log-detail').addEventListener('click', closeLogDetail);

  refreshList();
});
