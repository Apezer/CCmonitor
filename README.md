# CCmonitor

Claude Code 会话实时监控面板。通过 hook 机制捕获 Claude Code 的运行事件，在浏览器中实时展示工具调用、会话状态、对话历史和活动状态。

## 功能

- SSE 实时推送，零延迟
- 多会话支持（同时监控多个 Claude Code 会话，下拉切换）
- 交互式权限控制（在面板中 Allow / Deny 权限请求）
- 活动状态追踪（思考中 / 执行中 / 等待确认 / 子代理 / 压缩上下文 / 失败）
- 工具调用记录（Read / Write / Bash / Search 等分类图标，点击展开详情）
- 用户消息展示（UserPromptSubmit 捕获用户输入）
- 对话历史展示（权限请求消息红色醒目显示）
- 统计面板（总调用数、进行中、已完成、消息数）
- 历史会话浏览（SQLite 持久化）
- 搜索/筛选工具调用
- Session ID 一键复制
- 4 种主题切换（Dark / Light / Matrix / Amber）
- 移动端响应式布局

## 项目结构

```
CCmonitor/
├── server.js           # Node.js 服务端（Express + SQLite + SSE）
├── package.json        # Node.js 依赖配置
├── frontend/
│   ├── index.html      # 监控面板 HTML 结构
│   ├── style.css       # 样式（主题、布局、组件）
│   └── app.js          # 前端逻辑（SSE 接收、渲染、主题切换）
└── README.md
```

## 安装

### 前置条件

- Node.js 18+
- Claude Code

### 第一步：安装依赖

```bash
cd CCmonitor
npm install
```

### 第二步：配置 Claude Code hooks（HTTP hook，推荐）

编辑 `~/.claude/settings.json`，在 `hooks` 字段中添加以下配置：

```json
{
  "hooks": {
    "SessionStart": [
      { "hooks": [{ "type": "http", "url": "http://127.0.0.1:9090/hooks/claude" }] }
    ],
    "UserPromptSubmit": [
      { "hooks": [{ "type": "http", "url": "http://127.0.0.1:9090/hooks/claude" }] }
    ],
    "PreToolUse": [
      { "matcher": "*", "hooks": [{ "type": "http", "url": "http://127.0.0.1:9090/hooks/claude" }] }
    ],
    "PostToolUse": [
      { "matcher": "*", "hooks": [{ "type": "http", "url": "http://127.0.0.1:9090/hooks/claude" }] }
    ],
    "PostToolUseFailure": [
      { "matcher": "*", "hooks": [{ "type": "http", "url": "http://127.0.0.1:9090/hooks/claude" }] }
    ],
    "PermissionRequest": [
      { "matcher": "*", "hooks": [{ "type": "http", "url": "http://127.0.0.1:9090/hooks/claude", "timeout": 300000 }] }
    ],
    "PermissionDenied": [
      { "matcher": "*", "hooks": [{ "type": "http", "url": "http://127.0.0.1:9090/hooks/claude" }] }
    ],
    "SubagentStart": [
      { "hooks": [{ "type": "http", "url": "http://127.0.0.1:9090/hooks/claude" }] }
    ],
    "SubagentStop": [
      { "hooks": [{ "type": "http", "url": "http://127.0.0.1:9090/hooks/claude" }] }
    ],
    "Stop": [
      { "hooks": [{ "type": "http", "url": "http://127.0.0.1:9090/hooks/claude" }] }
    ],
    "StopFailure": [
      { "hooks": [{ "type": "http", "url": "http://127.0.0.1:9090/hooks/claude" }] }
    ],
    "Notification": [
      { "hooks": [{ "type": "http", "url": "http://127.0.0.1:9090/hooks/claude" }] }
    ],
    "SessionEnd": [
      { "hooks": [{ "type": "http", "url": "http://127.0.0.1:9090/hooks/claude" }] }
    ],
    "PreCompact": [
      { "hooks": [{ "type": "http", "url": "http://127.0.0.1:9090/hooks/claude" }] }
    ],
    "PostCompact": [
      { "hooks": [{ "type": "http", "url": "http://127.0.0.1:9090/hooks/claude" }] }
    ]
  }
}
```

> HTTP hook 无需 Python，Claude Code 直接 POST JSON 到服务器。

### 第三步：启动服务器

```bash
npm start
```

### 第四步：打开监控面板

浏览器访问 **http://localhost:9090**

## 工作原理

```
Claude Code ──(HTTP POST)──> server.js ──> SQLite + SSE ──> 浏览器
```

Claude Code 通过 HTTP hook 直接将事件 JSON POST 到 `server.js`，无需中间脚本。

### 支持的 Hook 事件

| 事件 | 触发时机 | 活动状态 |
|------|---------|---------|
| `SessionStart` | 会话开始 | idle |
| `UserPromptSubmit` | 用户提交 prompt | thinking |
| `PreToolUse` | 工具调用前 | running |
| `PostToolUse` | 工具调用成功 | thinking |
| `PostToolUseFailure` | 工具调用失败 | failed |
| `PermissionRequest` | 权限确认弹窗 | waiting |
| `PermissionDenied` | 权限被拒绝 | thinking |
| `SubagentStart` | 子代理启动 | subagent |
| `SubagentStop` | 子代理完成 | thinking |
| `PreCompact` | 上下文压缩前 | compacting |
| `PostCompact` | 上下文压缩后 | thinking |
| `Stop` | 响应完成 | idle |
| `StopFailure` | API 错误 | failed |
| `Notification` | 通知消息 | — |
| `SessionEnd` | 会话终止 | idle |

## API 端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/hooks/claude` | POST | HTTP hook 端点（Claude Code 直接调用） |
| `/api/event` | POST | 通用事件端点 |
| `/api/events` | GET | SSE 实时推送流 |
| `/api/permission/:id` | POST | 权限确认决策（Allow / Deny） |
| `/api/permissions` | GET | 当前待确认的权限列表 |
| `/api/active-session` | POST | 切换当前活跃会话 |
| `/api/sessions` | GET | 历史会话列表 |
| `/api/sessions/:id` | GET | 会话详情 |

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `9090` | 服务器端口 |

## 技术栈

- **服务端：** Node.js + Express + sql.js (SQLite)
- **通信：** Server-Sent Events (SSE) + HTTP Hooks
- **前端：** 原生 HTML / CSS / JavaScript（零依赖）
