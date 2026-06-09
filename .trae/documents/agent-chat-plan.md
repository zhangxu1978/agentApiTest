# Agent 对话页面实现计划

## 需求分析

用户需要一个 `agent.html` 页面，支持通过自然语言对话的方式让大模型帮助管理测试用接口。核心功能：

1. **对话界面** - 用户与agent进行自然语言交互
2. **工具调用能力** - agent能调用系统工具增删改测试接口
3. **配置管理** - 大模型配置独立存放在 `config.json` 文件中

## 现有系统分析

### 项目结构

```
agentApiTest/
├── src/
│   ├── public/          # 静态资源
│   │   ├── index.html   # 主管理页面
│   │   ├── app.js       # 前端逻辑
│   │   └── style.css    # 样式
│   ├── routes/
│   │   ├── admin.js     # 管理API路由
│   │   └── mock.js      # mock接口路由
│   ├── configService.js # 配置服务
│   ├── db.js            # 数据库连接
│   ├── logger.js        # 日志
│   ├── validator.js     # 验证器
│   └── response.js      # 响应处理
├── server.js            # 服务器入口
└── data/                # 数据库文件
```

### 现有API（可被agent调用）

* `GET /admin/api/configs` - 获取接口列表

* `POST /admin/api/configs` - 创建接口

* `PUT /admin/api/configs/:id` - 更新接口

* `DELETE /admin/api/configs/:id` - 删除接口

* `GET /admin/api/configs/:id` - 获取单个接口

## 实现方案

### 1. 创建配置文件 `config.json`

用于存储大模型配置，支持多服务商（OpenAI、Anthropic等）：

```json
{
  "agent": {
    "provider": "openai",
    "apiKey": "",
    "model": "gpt-4o-mini",
    "baseUrl": "https://api.openai.com/v1",
    "temperature": 0.1
  }
}
```

### 2. 创建 Agent 后端服务

**新增文件**: `src/agentService.js`

功能：

* 读取大模型配置

* 构建工具描述（Tool Description）

* 调用大模型并处理工具调用

* 执行工具调用并返回结果

**可用工具**:

| 工具名            | 描述       | 参数                                       |
| -------------- | -------- | ---------------------------------------- |
| `listConfigs`  | 获取所有接口列表 | 无                                        |
| `createConfig` | 创建新接口    | `name, path, method, response_body, ...` |
| `updateConfig` | 更新接口     | `id, name, path, ...`                    |
| `deleteConfig` | 删除接口     | `id`                                     |
| `getConfig`    | 获取单个接口   | `id`                                     |

### 3. 创建 Agent API 路由

**新增文件**: `src/routes/agent.js`

提供对话接口：

* `POST /agent/chat` - 发送消息，返回响应

### 4. 创建 Agent 前端页面

**新增文件**: `src/public/agent.html`

功能特性：

* 聊天消息列表（支持流式响应）

* 输入框发送消息

* 显示工具调用过程

* 配置入口链接

### 5. 更新服务器入口

**修改文件**: `server.js`

添加 agent 路由和静态资源支持

## 实施步骤

| 序号 | 任务                    | 文件                      | 状态  |
| -- | --------------------- | ----------------------- | --- |
| 1  | 创建 config.json 配置文件   | `config.json`           | 待实现 |
| 2  | 创建 agentService.js 服务 | `src/agentService.js`   | 待实现 |
| 3  | 创建 agent.js 路由        | `src/routes/agent.js`   | 待实现 |
| 4  | 创建 agent.html 页面      | `src/public/agent.html` | 待实现 |
| 5  | 更新 server.js 添加路由     | `server.js`             | 待实现 |
| 6  | 更新 index.html 添加导航链接  | `src/public/index.html` | 待实现 |

## 技术要点

1. **工具调用模式**：使用 OpenAI 风格的 function calling，让大模型决定何时调用工具
2. **响应流式输出**：支持 Server-Sent Events (SSE) 实现实时对话
3. **配置安全**：配置文件不应暴露敏感信息，建议仅服务端读取
4. **错误处理**：完善的错误处理和日志记录

## 依赖说明

需要安装额外依赖：

* `openai` - OpenAI API 客户端

* 或使用原生 HTTP 请求（无额外依赖）

建议采用原生 HTTP 请求方式，保持轻量级。

## 风险评估

| 风险         | 等级 | 应对措施             |
| ---------- | -- | ---------------- |
| API Key 泄露 | 高  | 配置文件仅服务端读取，不对外暴露 |
| 大模型调用失败    | 中  | 添加重试机制和错误提示      |
| 工具调用安全     | 中  | 严格参数校验，限制操作范围    |

