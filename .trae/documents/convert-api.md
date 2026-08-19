# 对外文档/图片转 Markdown 接口说明

> 本接口面向**外部系统**开放，用于把上传的文档或图片转成 Markdown 文本并直接返回。
> 调用方无需关心落库、UI、权限等内部细节，一次调用即可拿到 Markdown。

---

## 1. 基本信息

| 项目       | 值                                  |
| ---------- | ----------------------------------- |
| Base URL   | `http://127.0.0.1:3421`              |
| 路径       | `POST /api/convert`                 |
| Content-Type | `application/json`              |
| 鉴权       | 当前为内部工具，无鉴权（按部署要求自定） |
| 大小限制   | 60 MB（请求体） / 50 MB（解码后字节流） |

> 默认端口见 `server.js` 中的 `PORT` 环境变量，默认 `3421`。

---

## 2. 转换规则

| 输入类型 | 扩展名示例 | 处理方式 | 返回 `source` |
| --- | --- | --- | --- |
| 文本文档 | `.txt` `.md` `.json` `.csv` `.html` `.htm` `.xml` `.yaml` `.yml` `.log` | 原样返回（不转换） | `text` |
| Office 文档 | `.docx` `.pdf` `.pptx` `.xlsx` | 本地 `markitdown` 转 md | `markitdown` |
| 图片 | `.png` `.jpg` `.jpeg` `.gif` `.bmp` `.webp` `.svg` | 先转发到 `FILE_IMAGE_UPLOAD_URL` 拿到公网 URL，再调 minimax 多模态生成 md | `minimax-multimodal` |
| 其它 | 任何未匹配扩展名 | 走 `markitdown`（若 markitdown 不支持将报错） | `markitdown` |

---

## 3. 请求

### 3.1 三种输入方式（三选一）

调用方只需提供以下三种方式中的**任意一种**，服务端会自动读取文件内容：

| 方式 | 字段 | 说明 |
| --- | --- | --- |
| 🔶 **Base64 直传** | `contentBase64` | 文件内容 Base64 编码；支持裸 base64 或 `data:<mime>;base64,xxxx` 格式 |
| 🔶 **远程 URL** | `fileUrl` | HTTP/HTTPS URL，服务端自动下载 |
| 🔶 **本地路径** | `filePath` | 服务端可访问的**本地绝对路径**，由服务端直接读取 |

### 3.2 可选辅助字段

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `filename` | string | ⚠️ | 原始文件名（含扩展名），用于判断走哪种转换通道。通过 `fileUrl`/`filePath` 调用时**可省略**（自动推断）；通过 `contentBase64` 调用时**必填** |
| `mimeType` | string | ❌ | 原始 MIME，便于日志/审计 |

### 3.3 示例

**方式一：Base64 直传**
```json
{
  "filename": "spec.docx",
  "contentBase64": "UEsDBBQABgAIAAAAIQA..."
}
```

**方式二：远程 URL**
```json
{
  "fileUrl": "https://example.com/files/spec.pdf"
}
```

**方式三：本地路径**
```json
{
  "filePath": "D:\\docs\\spec.docx"
}
```

---

## 4. 响应

### 4.1 成功（HTTP 200）

```json
{
  "ok": true,
  "data": {
    "filename": "spec.docx",
    "mimeType": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "size": 12345,
    "input_source": "contentBase64",
    "markdown": "# 接口说明\n\n| 字段 | 类型 | 必填 | 说明 |\n| --- | --- | --- | --- |\n| id | string | 是 | 主键 |\n",
    "converted": true,
    "source": "markitdown",
    "imageUrl": null
  }
}
```

字段说明：

| 字段 | 含义 |
| --- | --- |
| `markdown` | 转换/原文返回的 Markdown 内容 |
| `converted` | `false` 表示原文直接返回（文本类），`true` 表示经过转换 |
| `source` | 转换通道：`text` / `markitdown` / `minimax-multimodal` |
| `input_source` | 输入来源：`contentBase64` / `fileUrl` / `filePath` |
| `imageUrl` | 仅图片通道返回，指上传代理返回的图片公网 URL |

### 4.2 失败

```json
{ "ok": false, "message": "错误描述" }
```

| HTTP | 触发场景 |
| --- | --- |
| 400 | 缺参数 / 参数重复 / `filePath` 不在白名单 / `fileUrl` 协议非法 / 下载失败 / DNS 失败 / 内网 IP 被拦截 |
| 404 | `filePath` 指向的文件不存在 |
| 413 | 文件超过 50 MB |
| 500 | markitdown 执行失败 / minimax 调用失败 / 图片上传代理失败 |
| 504 | `fileUrl` 下载超时（60s） |

---

## 5. 调用示例

### 5.1 本地文件路径（最简洁，推荐用于内网服务调用）

调用方只需把文件的绝对路径传过去，服务端自己读取：

```powershell
# PowerShell
$body = @{ filePath = "D:\\docs\\spec.docx" } | ConvertTo-Json -Compress
curl.exe -X POST "http://127.0.0.1:3421/api/convert" -H "Content-Type: application/json" -d $body
```

```bash
# Linux / macOS
curl -X POST "http://127.0.0.1:3421/api/convert" \
  -H "Content-Type: application/json" \
  -d '{"filePath":"/data/docs/spec.docx"}'
```

```js
// Node.js
const res = await fetch('http://127.0.0.1:3421/api/convert', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ filePath: 'D:/docs/spec.docx' })
});
const json = await res.json();
console.log(json.data.markdown);
```

```python
# Python
import requests
r = requests.post(
    'http://127.0.0.1:3421/api/convert',
    json={'filePath': 'D:/docs/spec.docx'},
    timeout=120
)
print(r.json()['data']['markdown'])
```

### 5.2 远程 URL（文件在第三方存储时使用）

```bash
curl -X POST "http://127.0.0.1:3421/api/convert" \
  -H "Content-Type: application/json" \
  -d '{"fileUrl":"https://oss.example.com/2026/08/spec.pdf"}'
```

### 5.3 Base64 直传（通用，文件不便于路径/URL 传递时使用）

```bash
# Linux / macOS
B64=$(base64 -w 0 spec.docx)
curl -X POST "http://127.0.0.1:3421/api/convert" \
  -H "Content-Type: application/json" \
  -d "{\"filename\":\"spec.docx\",\"contentBase64\":\"$B64\"}"
```

```powershell
# PowerShell
$bytes = [System.IO.File]::ReadAllBytes("D:\docs\spec.docx")
$b64   = [Convert]::ToBase64String($bytes)
$body  = @{ filename = "spec.docx"; contentBase64 = $b64 } | ConvertTo-Json -Compress
curl.exe -X POST "http://127.0.0.1:3421/api/convert" -H "Content-Type: application/json" -d $body
```

---

## 6. 依赖与配置

| 项 | 说明 |
| --- | --- |
| `markitdown` | 转换 docx/pdf 等 office 文档。需安装并在 PATH 中，可执行 `markitdown --version` 自检 |
| `FILE_IMAGE_UPLOAD_URL` | 图片转 md 前先把图片上传到该代理以获取公网 URL，默认 `http://127.0.0.1:3091/upload` |
| `config.json` 内 `agent.apiKey` / `agent.model` / `agent.baseUrl` | 用于 minimax 多模态调用 |
| `CONVERT_ALLOWED_DIRS` | 逗号分隔的本地目录白名单（`D:\docs;D:\shared`）。**不设置则不限制**（仅做路径穿越防护）；设置后仅允许这些目录下的文件通过 `filePath` 访问 |
| `CONVERT_BLOCK_PRIVATE_IP` | 是否禁止 `fileUrl` 访问内网/保留 IP（默认 `true`，防 SSRF）。设为 `false` 可临时关闭 |

---

## 7. 健康检查

`GET /api/convert/health`

```json
{
  "ok": true,
  "data": {
    "service": "convert",
    "time": "2026-08-04T10:00:00.000Z",
    "blockPrivateIp": true,
    "allowedDirs": "unrestricted"
  }
}
```

---

## 8. 安全说明

| 项目 | 说明 |
| --- | --- |
| **SSRF 防护** | `fileUrl` 访问前会 DNS 解析并校验，默认拦截内网/保留 IP（`127.*` `10.*` `172.16-31.*` `192.168.*` `169.254.*`） |
| **路径穿越防护** | `filePath` 使用 `path.resolve` 规范化后读取，拒绝 `\0` 字符；可选白名单模式（`CONVERT_ALLOWED_DIRS`） |
| **请求超时** | `fileUrl` 下载 60s 超时（HTTP 504） |
| **重定向限制** | 最多跟随 5 次重定向，检测循环重定向 |

## 9. 错误排查速查

| 现象 | 可能原因 |
| --- | --- |
| `找不到 markitdown 可执行文件` | 没装 markitdown 或未加入 PATH |
| `读取 config.json 失败` / `请先在 config.json 中配置 minimax API Key` | 缺少 minimax 凭据 |
| `图片上传代理失败 (HTTP xxx)` | `FILE_IMAGE_UPLOAD_URL` 不可达或返回非 2xx |
| `minimax 多模态响应为空` | minimax 凭据/网络异常，或图片无文本 |
| `禁止访问内网/保留 IP` | `fileUrl` 指向内网地址，可设 `CONVERT_BLOCK_PRIVATE_IP=false` 临时放开 |
| `路径不在允许目录内` | 设置了 `CONVERT_ALLOWED_DIRS` 白名单，当前路径不在其中 |
| `DNS 解析失败` | `fileUrl` 域名不可达或 DNS 异常 |
| 接口返回 `文件超过 50 MB` | 调小文件或调高 `MAX_SIZE` |

