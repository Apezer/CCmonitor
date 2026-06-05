# CCmonitor

Claude Code 会话实时监控面板。通过 hook 脚本捕获 Claude Code 的运行事件，在浏览器中实时展示工具调用、会话状态和对话历史。

## 功能

- 实时显示会话状态（运行中 / 空闲 / 出错）
- 工具调用记录（Read / Write / Bash / Search 等分类图标）
- 对话历史展示
- 统计面板（总调用数、进行中、已完成、消息数）
- Session ID 一键复制
- 4 种主题切换（Dark / Light / Matrix / Amber）
- 500ms 轮询间隔，接近实时

## 项目结构

```
CCmonitor/
├── frontend/
│   ├── index.html    # 监控面板 HTML 结构
│   ├── style.css     # 样式（主题、布局、组件）
│   ├── app.js        # 前端逻辑（轮询、渲染、主题切换）
│   └── data.json     # 运行时自动生成，hook.py 写入，前端轮询读取
├── hook.py           # Claude Code hook 脚本，捕获事件写入 data.json
└── README.md
```

## 安装

### 前置条件

- Python 3.x
- Node.js（用于启动 HTTP 服务器）
- Claude Code

### 第一步：配置 Claude Code hooks

编辑 `~/.claude/settings.json`，在 `hooks` 字段中添加以下配置：

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "python /你的路径/CCmonitor/hook.py"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "python /你的路径/CCmonitor/hook.py"
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "python /你的路径/CCmonitor/hook.py"
          }
        ]
      }
    ],
    "Notification": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "python /你的路径/CCmonitor/hook.py"
          }
        ]
      }
    ],
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "python /你的路径/CCmonitor/hook.py"
          }
        ]
      }
    ]
  }
}
```

> **Windows 用户注意：** 使用 `python` 而非 `python3`，后者是 Windows Store 占位符，无法正常工作。

> **路径格式：** 在 Git Bash 环境下使用 Unix 风格路径（如 `/d/AI_Project/CCmonitor/hook.py`），在 CMD/PowerShell 下使用 Windows 路径（如 `D:\AI_Project\CCmonitor\hook.py`）。

### 第二步：启动 HTTP 服务器

```bash
cd /你的路径/CCmonitor/frontend
npx serve -l 9090 -s .
```

### 第三步：打开监控面板

浏览器访问 **http://localhost:9090**

### 第四步：重启 Claude Code 会话

退出当前会话，启动一个新会话。hooks 会在会话启动时加载，之后所有工具调用和会话事件都会实时显示在面板上。

## 工作原理

```
Claude Code ──(hook 事件)──> hook.py ──(写入)──> data.json
                                                      │
浏览器面板 <──(每 500ms 轮询)── frontend/ <──(读取)────┘
```

1. Claude Code 在工具调用前后、会话开始/结束、收到通知时触发 hook
2. `hook.py` 通过 stdin 接收事件 JSON，解析后写入 `data.json`
3. `index.html` 每 500ms 请求 `data.json`，有变化时更新 DOM

### 支持的 Hook 事件

| 事件 | 触发时机 | 处理逻辑 |
|------|---------|---------|
| `SessionStart` | 会话开始 | 重置状态，清空旧数据 |
| `PreToolUse` | 工具调用前 | 记录工具名、参数摘要，标记 `running` |
| `PostToolUse` | 工具调用后 | 标记 `done`，记录响应摘要 |
| `Stop` | 会话结束 | 标记空闲，所有进行中的调用标记完成 |
| `Notification` | 收到通知 | 记录消息到对话历史 |

## 自定义

### 修改轮询间隔

编辑 `index.html` 中的 `POLL_INTERVAL` 值（单位：毫秒）：

```javascript
const POLL_INTERVAL = 500;  // 默认 500ms
```

### 修改数据保留数量

编辑 `hook.py` 中的常量：

```python
MAX_TOOL_CALLS = 100   # 最多保留工具调用记录数
MAX_MESSAGES = 50      # 最多保留消息数
```

## 技术栈

- **后端：** Python 3（hook 脚本）
- **前端：** 原生 HTML / CSS / JavaScript（零依赖）
- **通信：** 文件系统（data.json）+ HTTP 短轮询
- **服务器：** npx serve（静态文件服务）
