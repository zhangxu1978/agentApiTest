'use strict';

const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');

const configService = require('./configService');
const fileService = require('./fileService');
const conversationService = require('./conversationService');

let agentConfig = null;

function loadConfig() {
  const configPath = path.join(__dirname, '..', 'config.json');
  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    agentConfig = JSON.parse(content);
  } catch (e) {
    console.warn('[agent] 无法读取 config.json，使用默认配置');
    agentConfig = { agent: { provider: 'openai', apiKey: '', model: 'gpt-4o-mini', baseUrl: 'https://api.openai.com/v1', temperature: 0.1 } };
  }
}

loadConfig();

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'listConfigs',
      description: '获取所有已配置的API接口列表',
      parameters: { type: 'object', properties: {}, required: [] }
    }
  },
  {
    type: 'function',
    function: {
      name: 'getConfig',
      description: '根据ID获取单个API接口的详细信息',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'integer', description: '接口配置的ID' }
        },
        required: ['id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'createConfig',
      description: '创建一个新的API接口配置',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '接口名称，如：用户登录' },
          path: { type: 'string', description: '访问路径，必须以 / 开头，如：/api/auth/login' },
          method: { type: 'string', description: 'HTTP方法，可选值：GET、POST、PUT、DELETE、PATCH', enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'] },
          response_body: { type: 'string', description: '返回的JSON数据，必须是有效的JSON字符串' },
          response_status: { type: 'integer', description: 'HTTP响应状态码，默认200' },
          content_type: { type: 'string', description: '响应内容类型，默认 application/json; charset=utf-8' },
          error_format: { type: 'string', description: '错误响应格式，必须是有效的JSON字符串，支持占位符：{{code}} {{message}} {{field}}' },
          description: { type: 'string', description: '接口备注说明' },
          source_file_id: { type: 'integer', description: '挂载的上传文件ID（可选）' },
          params: { type: 'array', description: '入参定义数组' },
          headers: { type: 'array', description: '请求头校验数组' }
        },
        required: ['name', 'path', 'method', 'response_body', 'error_format']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'updateConfig',
      description: '更新已存在的API接口配置',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'integer', description: '要更新的接口配置ID' },
          name: { type: 'string', description: '接口名称' },
          path: { type: 'string', description: '访问路径' },
          method: { type: 'string', description: 'HTTP方法' },
          response_body: { type: 'string', description: '返回的JSON数据' },
          response_status: { type: 'integer', description: 'HTTP响应状态码' },
          content_type: { type: 'string', description: '响应内容类型' },
          error_format: { type: 'string', description: '错误响应格式' },
          description: { type: 'string', description: '接口备注说明' },
          source_file_id: { type: 'integer', description: '挂载的上传文件ID（传 null 表示解绑）' },
          params: { type: 'array', description: '入参定义数组' },
          headers: { type: 'array', description: '请求头校验数组' }
        },
        required: ['id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'deleteConfig',
      description: '删除指定的API接口配置',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'integer', description: '要删除的接口配置ID' }
        },
        required: ['id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'listFiles',
      description: '获取所有已上传的文件列表',
      parameters: { type: 'object', properties: {}, required: [] }
    }
  },
  {
    type: 'function',
    function: {
      name: 'getFile',
      description: '查看某个上传文件的内容（Markdown 形式）',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'integer', description: '文件ID' }
        },
        required: ['id']
      }
    }
  }
];

async function callTool(name, args) {
  switch (name) {
    case 'listConfigs':
      return { success: true, data: configService.listConfigs() };
    case 'getConfig': {
      const config = configService.getConfig(args.id);
      return config ? { success: true, data: config } : { success: false, message: '配置不存在' };
    }
    case 'createConfig':
      try {
        const data = configService.createConfig(args);
        return { success: true, data };
      } catch (e) {
        return { success: false, message: e.message };
      }
    case 'updateConfig':
      try {
        const data = configService.updateConfig(args.id, args);
        return { success: true, data };
      } catch (e) {
        return { success: false, message: e.message };
      }
    case 'deleteConfig': {
      const ok = configService.deleteConfig(args.id);
      return ok ? { success: true } : { success: false, message: '配置不存在' };
    }
    case 'listFiles':
      return { success: true, data: fileService.listFiles() };
    case 'getFile': {
      const file = fileService.getFile(args.id);
      if (!file) return { success: false, message: '文件不存在' };
      const md = fileService.readMd(file.md_path);
      return { success: true, data: { id: file.id, name: file.name, original_name: file.original_name, content: md } };
    }
    default:
      return { success: false, message: `未知工具: ${name}` };
  }
}

function makeHttpRequest(options, body) {
  return new Promise((resolve, reject) => {
    const protocol = options.protocol === 'https:' ? https : http;
    const req = protocol.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, body: data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function callLLM(messages) {
  const config = agentConfig.agent;
  if (!config.apiKey || !config.apiKey.trim()) {
    throw new Error('请先在 config.json 中配置大模型 API Key');
  }

  const url = new URL(`${config.baseUrl}/chat/completions`);

  const toolMessages = messages.filter(m => m.role === 'tool');
  if (toolMessages.length > 0) {
    console.log('[agent] 发送的tool messages:', toolMessages.map(m => ({
      tool_call_id: m.tool_call_id,
      name: m.name,
      role: m.role
    })));
  }

  const body = JSON.stringify({
    model: config.model,
    messages,
    tools: TOOLS,
    tool_choice: 'auto',
    temperature: config.temperature,
    stream: false
  });

  const isHttps = url.protocol === 'https:';
  const options = {
    hostname: url.hostname,
    port: url.port || (isHttps ? 443 : 80),
    path: url.pathname + url.search,
    method: 'POST',
    protocol: url.protocol,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
      'Content-Length': Buffer.byteLength(body)
    }
  };

  const response = await makeHttpRequest(options, body);

  if (response.status !== 200) {
    console.error('[agent] LLM响应错误:', response.body);
    throw new Error(`LLM调用失败: ${response.status} - ${JSON.stringify(response.body)}`);
  }

  const responseToolCalls = response.body.choices?.[0]?.message?.tool_calls;
  if (responseToolCalls) {
    console.log('[agent] 收到的tool_calls:', responseToolCalls.map(tc => ({
      id: tc.id,
      functionName: tc.function?.name
    })));
  }

  return response.body;
}

function buildFileContext(fileIds) {
  if (!Array.isArray(fileIds) || fileIds.length === 0) return null;
  const sections = [];
  const truncated = [];
  for (const fid of fileIds) {
    const file = fileService.getFile(fid);
    if (!file) continue;
    let md = fileService.readMd(file.md_path);
    const MAX = 20000;
    let wasTruncated = false;
    if (md.length > MAX) {
      md = md.substring(0, MAX) + '\n\n...(内容过长已截断)...';
      wasTruncated = true;
    }
    sections.push(`### 文件 #${file.id} - ${file.original_name}\n\n${md}`);
    truncated.push({ id: file.id, name: file.original_name, truncated: wasTruncated });
  }
  if (sections.length === 0) return null;
  return {
    role: 'system',
    content: `以下是用户在本次会话中附带的上传文件，已由 markitdown 转换为 Markdown，请结合这些文档内容回复用户、生成接口或修改接口。当用户要求"根据 X 文件创建/修改接口"时，你必须参照下面文档内容。\n\n${sections.join('\n\n---\n\n')}`
  };
}

async function runConversation({ conversationId, fileIds, historyMessages, latestUserText, title, externalId = null }) {
  // 1. 解析 / 创建会话
  let conversation = null;
  let resolvedConvId = null;

  if (externalId != null && String(externalId).trim() !== '') {
    // 外部传入的字符串 ID 优先 → 按 external_id 查
    conversation = conversationService.findByExternalId(externalId);
    if (conversation) resolvedConvId = conversation.id;
  }
  if (!conversation && conversationId != null && String(conversationId).trim() !== '') {
    const numericId = Number(conversationId);
    if (!Number.isNaN(numericId)) {
      conversation = conversationService.getConversation(numericId);
      if (conversation) {
        resolvedConvId = conversation.id;
        // 若调用方外部 ID 与内部 ID 共存（外部场景），同步外部 ID
        if (externalId != null && String(externalId).trim() !== '' && !conversation.externalId) {
          conversationService.setExternalId(conversation.id, externalId);
        }
      }
    }
  }

  if (!conversation) {
    const inferredTitle = (title && String(title).trim())
      || (latestUserText ? String(latestUserText).replace(/\s+/g, ' ').slice(0, 40) : '新对话');
    const createOpts = { title: inferredTitle, fileIds };
    if (externalId != null && String(externalId).trim() !== '') {
      createOpts.externalId = externalId;
    }
    conversation = conversationService.createConversation(createOpts);
    resolvedConvId = conversation.id;
  }
  conversationService.touchConversation(resolvedConvId, Array.isArray(fileIds) ? fileIds : []);

  // 2. 持久化最新一条用户原文（无论来自外部 AI 还是前端，仅存原文）
  const userText = (latestUserText || '').toString();
  if (userText) {
    conversationService.appendMessage(resolvedConvId, { role: 'user', content: userText });
  }

  return _runAgentLoop(resolvedConvId, fileIds, historyMessages, userText);
}

async function _runAgentLoop(conversationId, fileIds, historyMessages, userText) {
  const MAX_ITERATIONS = 5;

  const systemPrompt = {
    role: 'system',
    content: `你是一个API接口管理助手，帮助用户管理测试用的Mock接口。

你的任务是：
1. 理解用户的自然语言请求
2. 根据需要调用工具来完成操作
3. 用友好的自然语言总结结果给用户

可用工具：
- listConfigs: 获取所有接口列表
- getConfig(id): 获取单个接口详情
- createConfig(params): 创建新接口
- updateConfig(params): 更新接口
- deleteConfig(id): 删除接口
- listFiles: 列出已上传的所有文件
- getFile(id): 查看某个上传文件的内容

接口配置参数说明：
- name: 接口名称（必填）
- path: 访问路径，必须以 / 开头（必填）
- method: HTTP方法，可选值：GET、POST、PUT、DELETE、PATCH（必填）
- response_body: 返回的JSON数据，必须是有效的JSON字符串（必填）
- response_status: HTTP响应状态码，默认200
- content_type: 响应内容类型，默认 application/json; charset=utf-8
- error_format: 错误响应格式，必须是有效的JSON字符串，支持占位符：{{code}} {{message}} {{field}}（必填）
- description: 接口备注说明（可选）
- source_file_id: 挂载的上传文件ID（可选），表示该接口是从哪个上传文件衍生而来的
- params: 入参定义数组（可选）
- headers: 请求头校验数组（可选）

注意：
- 创建或更新接口时，response_body 和 error_format 必须是有效的JSON字符串
- path 必须以 / 开头
- 如果用户基于某个文件创建接口，建议在 description 里说明该接口来自哪个文件，并把 source_file_id 设为对应文件ID
- 回复时要用中文，保持友好自然`
  };

  const fileContext = buildFileContext(fileIds);
  const llmMessages = [systemPrompt];
  if (fileContext) llmMessages.push(fileContext);
  if (Array.isArray(historyMessages)) llmMessages.push(...historyMessages);
  if (userText) llmMessages.push({ role: 'user', content: userText });

  const toolCalls = [];

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    const response = await callLLM(llmMessages);
    const choice = response.choices?.[0];
    if (!choice) throw new Error('LLM响应格式错误');

    const message = choice.message;

    if (message.tool_calls && message.tool_calls.length > 0) {
      console.log('[agent] 收到工具调用:', message.tool_calls.map(tc => ({
        toolCallId: tc.id,
        functionName: tc.function.name
      })));

      llmMessages.push(message);

      for (const toolCall of message.tool_calls) {
        const args = JSON.parse(toolCall.function.arguments);
        const toolResult = await callTool(toolCall.function.name, args);

        toolCalls.push({
          name: toolCall.function.name,
          args,
          result: toolResult
        });

        const toolMessage = {
          role: 'tool',
          content: JSON.stringify(toolResult),
          name: toolCall.function.name,
          tool_call_id: toolCall.id
        };

        console.log('[agent] 发送工具结果:', {
          toolCallId: toolCall.id,
          functionName: toolCall.function.name
        });

        llmMessages.push(toolMessage);
      }
    } else {
      const finalContent = message.content || '操作完成';
      conversationService.appendMessage(conversationId, {
        role: 'assistant',
        content: finalContent,
        toolCalls
      });
      return {
        type: 'text',
        content: finalContent,
        toolCalls,
        fileIds,
        conversationId
      };
    }
  }

  const finalResponse = await callLLM(llmMessages);
  const finalChoice = finalResponse.choices?.[0];
  const finalContent = finalChoice?.message?.content || '操作完成';
  conversationService.appendMessage(conversationId, {
    role: 'assistant',
    content: finalContent,
    toolCalls
  });

  return {
    type: 'text',
    content: finalContent,
    toolCalls,
    fileIds,
    conversationId
  };
}

async function chat(messages, fileIds = [], options = {}) {
  const { conversationId: incomingConvId, title } = options;

  const incomingMessages = Array.isArray(messages) ? messages : [];
  const lastUser = [...incomingMessages].reverse().find((m) => m && m.role === 'user');
  const latestUserText = lastUser ? (lastUser.content || '') : '';
  // 前端场景：调用方已经把完整 messages 传进来了，这里直接当作 history 用，
  // 服务端再把最后一条 user 原文追加一次入库，避免重复。
  const historyMessages = incomingMessages
    .filter((m) => !(lastUser && m === lastUser))
    .map((m) => ({ role: m.role, content: m.content || '' }));

  return runConversation({
    conversationId: incomingConvId,
    fileIds,
    historyMessages,
    latestUserText,
    title
  });
}

// 供外部 AI 使用的入口：只接收字符串消息，由服务端从 DB 拼历史
async function externalChat({ conversationId, message, fileIds, title }) {
  const userText = (message == null ? '' : String(message)).trim();
  if (!userText) {
    const err = new Error('message 不能为空');
    err.statusCode = 400;
    throw err;
  }

  // 外部的 conversationId 直接当作 externalId 用（按字符串处理；新建时落库，后续按它查）
  const externalId = (conversationId == null || String(conversationId).trim() === '')
    ? null
    : String(conversationId).trim();

  // 如果该 externalId 已存在 → 拉历史拼上下文
  let historyMessages = [];
  if (externalId) {
    const conv = conversationService.findByExternalId(externalId);
    if (conv) {
      historyMessages = (conv.messages || [])
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({ role: m.role, content: m.content || '' }));
    }
  }

  return runConversation({
    conversationId: null,           // 外部场景不主动用内部数字 ID
    externalId,
    fileIds,
    historyMessages,
    latestUserText: userText,
    title
  });
}

function getConfig() {
  return agentConfig;
}

function reloadConfig() {
  loadConfig();
  return agentConfig;
}

module.exports = {
  chat,
  externalChat,
  getConfig,
  reloadConfig,
  listConversations: conversationService.listConversations,
  getConversation: conversationService.getConversation,
  createConversation: conversationService.createConversation,
  renameConversation: conversationService.renameConversation,
  deleteConversation: conversationService.deleteConversation,
};
