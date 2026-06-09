# API Mock 测试工具 — 实施计划

## 一、Summary

构建一个本地运行的 API Mock 测试工具，核心能力：
- **Web 管理界面**：可视化配置 API（方法名、HTTP 方法、路径、请求头、入参、内容类型、返回数据、错误格式）。
- **Mock 服务端**：根据配置启动真实 HTTP 接口，外部系统可正常调用，参数缺失或不符合规则时按配置的"错误格式"返回。
- **持久化**：所有配置写入 SQLite，工具重启后保留。
- **零认证**：内网/本地使用，Web 管理页与 Mock 接口均不要求登录。

技术栈：**Node.js + Express + better-sqlite3 + 原生 HTML/JS 前端**。

---

## 二、Current State Analysis

工作目录 `d:\work\work\git\tools\agentApiTest` 当前**完全为空**（无任何文件、无 `.trae` 目录），属于全新项目。所有文件均需从零创建。

无现有架构、无既有依赖、无既有约定可继承。

---

## 三、Proposed Changes

### 3.1 目录结构

```
agentApiTest/
├── package.json                    # 项目元数据 + 依赖
├── .gitignore                      # 忽略 node_modules / data/*.db
├── server.js                       # Express 入口（启动服务 + 加载路由）
├── data/
│   └── .gitkeep                    # SQLite 文件运行时生成
├── src/
│   ├── db.js                       # better-sqlite3 初始化 + 建表
│   ├── configService.js            # 配置 CRUD（读、写、更新、删除）
│   ├── validator.js                # 参数/请求头校验逻辑
│   ├── response.js                 # 响应/错误格式化工具
│   ├── routes/
│   │   ├── admin.js                # 管理界面后端 API（/admin/api/...）
│   │   └── mock.js                 # Mock 接口分发（按 path 前缀匹配）
│   └── public/                     # 静态文件（管理 UI）
│       ├── index.html              # 主页面
│       ├── app.js                  # 前端逻辑
│       └── style.css               # 样式
└── README.md                       # 启动说明（首次启动步骤）
```

### 3.2 依赖（package.json）

- **运行时**：`express`、`better-sqlite3`
- **开发时**：`nodemon`（开发热重载，可选）

启动命令：
```json
"scripts": {
  "start": "node server.js",
  "dev": "nodemon server.js"
}
```

### 3.3 数据模型（SQLite，建在 `data/mock.db`）

**表 `api_configs`（API 主配置）**
| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK AUTOINCREMENT | |
| name | TEXT NOT NULL | 接口名称（中文/英文均可） |
| path | TEXT NOT NULL UNIQUE | 完整路径，如 `/api/userGroup/getUserInfo` |
| method | TEXT NOT NULL | `GET` / `POST` / `PUT` / `DELETE` / `PATCH` |
| content_type | TEXT NOT NULL | 默认 `application/json; charset=utf-8` |
| response_status | INTEGER NOT NULL DEFAULT 200 | HTTP 状态码 |
| response_body | TEXT NOT NULL | JSON 字符串，预设返回数据 |
| error_format | TEXT NOT NULL | JSON 字符串，错误返回模板 |
| description | TEXT | 备注 |
| created_at | TEXT | ISO 时间 |
| updated_at | TEXT | ISO 时间 |

**表 `api_params`（入参定义）**
| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | |
| config_id | INTEGER NOT NULL FK | 关联 api_configs.id |
| name | TEXT NOT NULL | 参数名 |
| location | TEXT NOT NULL | `query` / `body` / `path` |
| type | TEXT NOT NULL | `string` / `number` / `boolean` / `object` / `array` |
| required | INTEGER NOT NULL DEFAULT 0 | 0/1 |
| min_length | INTEGER | 字符串最小长度 |
| max_length | INTEGER | 字符串最大长度 |
| min_value | REAL | 数字最小值 |
| max_value | REAL | 数字最大值 |
| pattern | TEXT | 正则表达式（字符串） |
| description | TEXT | |

**表 `api_headers`（必填/校验请求头）**
| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | |
| config_id | INTEGER NOT NULL FK | |
| name | TEXT NOT NULL | header 名（不区分大小写匹配） |
| required | INTEGER NOT NULL DEFAULT 0 | 0/1 |
| pattern | TEXT | 可选正则 |

外键：`api_params.config_id`、`api_headers.config_id` → `api_configs.id`，`ON DELETE CASCADE`。

### 3.4 关键模块设计

**`server.js`（入口）**
- 端口默认 `3000`（可用 `PORT` 环境变量覆盖）。
- 加载 `src/db.js` 初始化数据库。
- 挂载 `src/routes/admin.js` → `/admin/api/*`。
- 挂载 `src/routes/mock.js` → 通用 catch-all（在 admin 路由之后注册）。
- 托管 `src/public` 静态资源 → `/`。
- 全局错误处理：未捕获异常统一 JSON 返回。

**`src/db.js`**
- 打开 `data/mock.db`，不存在则创建。
- 启动时执行 `CREATE TABLE IF NOT EXISTS ...` 建表语句。
- 导出 `db` 单例。

**`src/configService.js`**
- `listConfigs()`、`getConfig(id)`、`getConfigByPath(path)`、`createConfig(data)`、`updateConfig(id, data)`、`deleteConfig(id)`。
- 写入/更新时同时处理 `api_params`、`api_headers` 子表（事务，删旧插新）。

**`src/validator.js`**
- `validateRequest(config, req)` → 返回 `{ ok: true }` 或 `{ ok: false, errors: [...] }`。
- 校验顺序：Content-Type → 请求头 → 入参（按 location 分别从 `req.query` / `req.body` / `req.params` 取）。
- 错误项结构：`{ field, location, code, message }`，`code` 取 `REQUIRED` / `TYPE_ERROR` / `TOO_SHORT` / `TOO_LONG` / `OUT_OF_RANGE` / `PATTERN_MISMATCH` / `MISSING_HEADER` / `HEADER_PATTERN_MISMATCH`。

**`src/response.js`**
- `success(body, status, contentType)`：按 `config.response_body` 直接返回。
- `error(format, code, message, field)`：把 `error_format`（JSON 字符串）解析为对象，注入 `code`、`message`、`field`，按 `config.response_status` 返回。
- `error_format` 支持占位符：`{{code}}` `{{message}}` `{{field}}`，渲染时替换。

**`src/routes/admin.js`（管理 API）**
- `GET    /admin/api/configs`         列表（包含参数和头数量）
- `GET    /admin/api/configs/:id`      详情
- `POST   /admin/api/configs`          新增
- `PUT    /admin/api/configs/:id`      更新
- `DELETE /admin/api/configs/:id`      删除
- `POST   /admin/api/configs/:id/test` 可选：使用示例入参调用一次，校验逻辑走 mock 路由相同路径（便于在 UI 里点"测试"）

请求/响应均为 JSON。提供简单的字段校验（name 必填、path 以 `/` 开头、method 枚举等）。

**`src/routes/mock.js`（Mock 分发）**
- 任意 method 的 catch-all（注册在 admin 路由之后）：
  1. 从 `req.path` 查 `api_configs` 表（注意 GET/POST/... 都要能命中，所以通过 `req.method + req.path` 精确匹配）。
  2. 找不到 → 404 JSON：`{ code: 'NOT_FOUND', message: 'API 不存在' }`。
  3. 找到 → 解析 body（如果 Content-Type 是 `application/json`）、调 `validateRequest`。
  4. 校验失败 → `response.error(...)`。
  5. 校验通过 → `response.success(...)`。

**`src/public/index.html`（管理 UI）**

单页面应用（无框架，原生 JS）：

- 左侧：API 列表（搜索框 + 卡片列表，含方法徽章 + 路径 + 名称 + 编辑/删除/测试按钮）。
- 右侧：编辑器（点击左侧项后渲染），分多个折叠面板：
  1. **基本信息**：name / method / path / content_type / response_status / description
  2. **请求头校验**：动态行表格（name / required / pattern）
  3. **入参定义**：动态行表格（name / location / type / required / min_length / max_length / min / max / pattern）
  4. **返回数据**：`response_body` 多行 JSON 编辑框 + 实时校验 JSON 合法性
  5. **错误格式**：`error_format` 多行 JSON 编辑框 + 实时校验
- 顶部按钮：**新建 / 保存 / 取消 / 删除 / 测试调用**。
- 测试调用面板：填写示例 query/body/header → 点"调用" → 显示请求详情、响应状态、响应头、响应体。

样式：简洁现代，使用 CSS 变量 + flex/grid 布局。

### 3.5 关键流程示例

**配置示例 1：登录接口**

- name: `用户登录`
- method: `POST`
- path: `/api/auth/login`
- content_type: `application/json; charset=utf-8`
- response_status: `200`
- response_body: `{"code":0,"message":"ok","data":{"token":"mock-token-abc123"}}`
- error_format: `{"code":1001,"message":"{{message}}","field":"{{field}}"}`
- 请求头校验：`Content-Type` 必填
- 入参：
  - `username`（body, string, 必填, 长度 3~20）
  - `password`（body, string, 必填, 长度 6~32）

外部调用 `POST /api/auth/login` 缺少 `username` → 返回 `{"code":1001,"message":"username 必填","field":"username"}`，HTTP 200（`response_status` 仍为 200，错误信息在 body 内，可按需改为 400）。

### 3.6 错误格式占位符

`error_format`（JSON 字符串）支持以下占位符，渲染时替换：
- `{{code}}` → 错误码（`REQUIRED` / `TYPE_ERROR` / ...）
- `{{message}}` → 人类可读消息
- `{{field}}` → 出错的字段名（没有时为空字符串）

---

## 四、Assumptions & Decisions

1. **单实例本地使用**：不部署到公网，不做并发安全加固，单进程足够。
2. **静态响应**：用户明确选择"仅静态响应"，不做模板渲染、不做动态变量。
3. **无认证**：管理页面和 Mock 接口都不要求登录，假设仅在受信任网络使用。
4. **错误仍返回 200**：HTTP 状态码使用 `response_status`（默认 200），业务错误体现在 body 的 `code` 字段——这是 Mock 测试的常见做法，便于客户端统一处理。如需"校验失败用 400"，可在配置时把 `response_status` 改为 400。
5. **路径前缀自定义**：通过配置项的 `path` 字段直接写完整路径实现（`/api/...`、`/mock/...`、`/v1/...` 都可），无需全局前缀设置。
6. **不支持 PATCH/PUT/DELETE 的 body 解析**：依赖 Express 内置 `express.json()`，已能处理 `application/json`。
7. **数据库迁移**：当前阶段不引入迁移工具（Knex/Prisma），建表 SQL 直接写在 `db.js` 中。
8. **首次启动**：首次运行 `npm start` 会自动创建 `data/mock.db` 和所有表，无需手动迁移。
9. **Windows 环境**：用户系统为 Windows，使用 PowerShell。`README` 中的命令使用 `npm` 跨平台写法。`better-sqlite3` 在 Windows 上需要 node-gyp，README 会提示如安装失败可使用预编译版本（npm 7+ 默认会拉取预编译二进制）。

---

## 五、Verification

按以下步骤验证实现是否达标：

1. **安装与启动**
   - `cd d:\work\work\git\tools\agentApiTest`
   - `npm install`
   - `npm start`
   - 浏览器打开 `http://localhost:3000/`，看到管理界面。

2. **新建 API（用户登录）**
   - 在 UI 中按 §3.5 的示例配置接口，点保存。
   - 列表出现该接口。

3. **外部调用 — 成功路径**
   - `curl.exe -X POST http://localhost:3000/api/auth/login -H "Content-Type: application/json" -d '{\"username\":\"alice\",\"password\":\"secret123\"}'`
   - 期望：返回 `{"code":0,"message":"ok","data":{"token":"mock-token-abc123"}}`，HTTP 200。

4. **外部调用 — 缺参**
   - `curl.exe -X POST http://localhost:3000/api/auth/login -H "Content-Type: application/json" -d '{\"username\":\"alice\"}'`
   - 期望：返回 `{"code":1001,"message":"password 必填","field":"password"}`。

5. **外部调用 — 类型错误**
   - `curl.exe -X POST http://localhost:3000/api/auth/login -H "Content-Type: application/json" -d '{\"username\":123,\"password\":\"secret\"}'`
   - 期望：`field=username`，`code=TYPE_ERROR`。

6. **外部调用 — 长度不足**
   - `curl.exe -X POST http://localhost:3000/api/auth/login -H "Content-Type: application/json" -d '{\"username\":\"ab\",\"password\":\"secret\"}'`
   - 期望：`field=username`，`code=TOO_SHORT`，message 提示最小长度 3。

7. **UI 测试按钮**
   - 在管理界面点击"测试调用"，填示例入参，点调用，能看到和 curl 相同的响应展示。

8. **修改/删除/重启持久化**
   - 改一条配置 → 重启 `npm start` → 修改仍在。
   - 删除一条配置 → 调用对应路径返回 404。

9. **多接口**
   - 至少再配置 1 个 GET 接口（如 `/api/health`），用 `curl.exe "http://localhost:3000/api/health?token=xxx"`，验证 query 校验也工作。

10. **404 路径**
    - `curl.exe http://localhost:3000/api/notExist` → 返回 NOT_FOUND。
