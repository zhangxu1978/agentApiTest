'use strict';

const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');

const configService = require('./configService');

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
  }
];

async function callTool(name, args) {
  switch (name) {
    case 'listConfigs':
      return { success: true, data: configService.listConfigs() };
    case 'getConfig':
      const config = configService.getConfig(args.id);
      return config ? { success: true, data: config } : { success: false, message: '配置不存在' };
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
    case 'deleteConfig':
      const ok = configService.deleteConfig(args.id);
      return ok ? { success: true } : { success: false, message: '配置不存在' };
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
    throw new Error(`LLM调用失败: ${response.status} - ${JSON.stringify(response.body)}`);
  }

  return response.body;
}

async function chat(messages) {
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

接口配置参数说明：
- name: 接口名称（必填）
- path: 访问路径，必须以 / 开头（必填）
- method: HTTP方法，可选值：GET、POST、PUT、DELETE、PATCH（必填）
- response_body: 返回的JSON数据，必须是有效的JSON字符串（必填）
- response_status: HTTP响应状态码，默认200
- content_type: 响应内容类型，默认 application/json; charset=utf-8
- error_format: 错误响应格式，必须是有效的JSON字符串，支持占位符：{{code}} {{message}} {{field}}（必填）
- description: 接口备注说明（可选）
- params: 入参定义数组（可选）
- headers: 请求头校验数组（可选）

注意：
- 创建或更新接口时，response_body 和 error_format 必须是有效的JSON字符串
- path 必须以 / 开头
- 回复时要用中文，保持友好自然`
  };

  const allMessages = [systemPrompt, ...messages];
  const response = await callLLM(allMessages);
  
  const choice = response.choices?.[0];
  if (!choice) throw new Error('LLM响应格式错误');

  const message = choice.message;
  
  if (message.tool_calls && message.tool_calls.length > 0) {
    const toolCall = message.tool_calls[0];
    const toolResult = await callTool(toolCall.function.name, JSON.parse(toolCall.function.arguments));
    
    const toolMessage = {
      role: 'tool',
      content: JSON.stringify(toolResult),
      tool_call_id: toolCall.id
    };
    
    const finalResponse = await callLLM([...allMessages, message, toolMessage]);
    const finalChoice = finalResponse.choices?.[0];
    
    return {
      type: 'text',
      content: finalChoice?.message?.content || '操作完成',
      toolCall: {
        name: toolCall.function.name,
        args: JSON.parse(toolCall.function.arguments),
        result: toolResult
      }
    };
  }

  return { type: 'text', content: message.content };
}

function getConfig() {
  return agentConfig;
}

function reloadConfig() {
  loadConfig();
  return agentConfig;
}

module.exports = { chat, getConfig, reloadConfig };
