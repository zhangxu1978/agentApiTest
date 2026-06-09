# API Mock 测试工具

本地运行的 API Mock 服务 + Web 管理界面。

可配置：
1. **接口名称**
2. **HTTP 方法**（GET / POST / PUT / DELETE / PATCH）
3. **请求头**（必填 + 正则校验）
4. **入参**（位置 `query/body/path`、类型 `string/number/boolean/object/array`、必填、最小/最大长度、最小/最大值、正则）
5. **内容类型**（`Content-Type`，默认 `application/json; charset=utf-8`）
6. **返回数据**（预设 JSON 响应）
7. **错误格式**（JSON 模板，支持 `{{code}}` `{{message}}` `{{field}}` 占位符）

外部按配置好的路径访问，参数缺失/类型错误/长度越界/正则不匹配时，按错误格式返回。

---

## 快速开始

需要 Node.js 18+。

```powershell
cd d:\work\work\git\tools\agentApiTest
npm install
npm start
```

打开浏览器访问 <http://localhost:3000/> 即可看到管理界面。

修改端口：设置环境变量 `PORT`，例如 `PORT=8080 npm start`。

---

## 使用示例

### 1. 在管理界面新建接口

**简单接口（用户登录）：**

| 字段 | 值 |
|------|-----|
| 接口名称 | 用户登录 |
| HTTP 方法 | POST |
| 访问路径 | /api/auth/login |
| 内容类型 | application/json; charset=utf-8 |
| 响应状态码 | 200 |
| 返回数据 | `{"code":0,"message":"ok","data":{"token":"mock-token-abc123"}}` |
| 错误格式 | `{"code":1001,"message":"{{message}}","field":"{{field}}"}` |

请求头：`Content-Type` 必填
入参：
- `username` (body, string, 必填, 长度 3~20)
- `password` (body, string, 必填, 长度 6~32)

**嵌套接口（处方提交）：**

入参结构：
```
input (body, object, 必填)
├── req_info (object, 必填)
│   ├── pres_no    (string, 必填, 长度 8~32)
│   └── pres_type  (string, 必填, 正则 ^[0-9]+$)
└── head     (object, 必填)
    ├── bizno     (string, 必填)
    ├── sysno     (string, 必填)
    ├── tarno     (string, 选填)
    ├── time      (string, 选填)
    └── action_no (string, 选填)
```

调用时如缺 `input.req_info.pres_type`，错误：`{"code":1001,"message":"input.req_info.pres_type 必填","field":"input.req_info.pres_type"}`。

### 2. 外部调用

**成功**：
```powershell
curl.exe -X POST http://localhost:3000/api/auth/login `
  -H "Content-Type: application/json" `
  -d '{"username":"alice","password":"secret123"}'
```
返回：`{"code":0,"message":"ok","data":{"token":"mock-token-abc123"}}`

**缺参**：
```powershell
curl.exe -X POST http://localhost:3000/api/auth/login `
  -H "Content-Type: application/json" `
  -d '{"username":"alice"}'
```
返回：`{"code":"REQUIRED","message":"password 必填","field":"password"}`

**类型错误**：
```powershell
curl.exe -X POST http://localhost:3000/api/auth/login `
  -H "Content-Type: application/json" `
  -d '{"username":123,"password":"secret"}'
```
返回：`{"code":"TYPE_ERROR","message":"username 类型应为 string","field":"username"}`

---

## 路径前缀

每个接口的 `访问路径` 是完整路径，因此支持任意前缀：
- `/api/...`
- `/mock/...`
- `/v1/...`

---

## 错误格式占位符

`error_format`（JSON 字符串）支持：
- `{{code}}` — 错误码（`REQUIRED` / `TYPE_ERROR` / `TOO_SHORT` / `TOO_LONG` / `OUT_OF_RANGE` / `PATTERN_MISMATCH` / `MISSING_HEADER` / `HEADER_PATTERN_MISMATCH`）
- `{{message}}` — 人类可读消息
- `{{field}}` — 出错的字段名

如需在校验失败时返回 HTTP 400，把接口的 `响应状态码` 配置为 400 即可。

---

## 目录结构

```
agentApiTest/
├── server.js                # Express 入口
├── package.json
├── data/mock.db             # SQLite 数据库（运行时生成）
└── src/
    ├── db.js                # SQLite 初始化 + 建表
    ├── configService.js     # 配置 CRUD
    ├── validator.js         # 参数/请求头校验
    ├── response.js          # 响应/错误格式化
    ├── routes/
    │   ├── admin.js         # 管理 API: /admin/api/configs
    │   └── mock.js          # Mock 路由: catch-all 分发
    └── public/              # Web 管理界面（静态资源）
        ├── index.html
        ├── app.js
        └── style.css
```

---

## 管理 API

- `GET    /admin/api/configs`          列表
- `GET    /admin/api/configs/:id`       详情
- `POST   /admin/api/configs`           新增
- `PUT    /admin/api/configs/:id`       更新
- `DELETE /admin/api/configs/:id`       删除

请求/响应均为 JSON。

---

## 常见问题

**Q: `better-sqlite3` 安装失败？**
A: Node 18+ 通常会自动下载预编译的二进制。如果失败，可安装 `windows-build-tools` 后重试。

**Q: 数据存在哪？**
A: `data/mock.db`，删除该文件即重置所有配置。

**Q: 是否支持多用户/权限？**
A: 当前版本不包含认证，仅建议在内网或本机使用。
