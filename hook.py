#!/usr/bin/env python3
"""
Claude Code Hook Script
将 Claude Code 的 hook 事件写入 data.json，供网页读取。

用法：在 Claude Code 的 settings.json 中配置 hooks，
将此脚本作为命令：python3 /path/to/hook.py
"""

import json
import sys
import os
from datetime import datetime

# data.json 放在 frontend 目录下，供前端直接读取
DATA_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "frontend", "data.json")

# 最多保留多少条工具调用记录
MAX_TOOL_CALLS = 100
# 最多保留多少条对话历史
MAX_MESSAGES = 50


def load_data():
    if os.path.exists(DATA_FILE):
        try:
            with open(DATA_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {
        "session": {"id": None, "status": "idle", "started_at": None},
        "current_task": None,
        "tool_calls": [],
        "messages": [],
        "last_updated": None,
    }


def save_data(data):
    data["last_updated"] = datetime.now().isoformat()
    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def now():
    return datetime.now().isoformat()


def handle_event(event_name, payload):
    data = load_data()

    if event_name == "PreToolUse":
        session_id = payload.get("session_id", "")
        tool_name = payload.get("tool_name", "unknown")
        tool_input = payload.get("tool_input", {})

        # 更新 session 状态
        data["session"]["id"] = session_id
        data["session"]["status"] = "running"
        if not data["session"]["started_at"]:
            data["session"]["started_at"] = now()

        # 记录工具调用
        call = {
            "id": f"{tool_name}-{now()}",
            "tool": tool_name,
            "input": tool_input,
            "status": "running",
            "started_at": now(),
            "finished_at": None,
        }

        # 为常见工具提取可读摘要
        summary = summarize_tool(tool_name, tool_input)
        call["summary"] = summary

        data["tool_calls"].insert(0, call)
        data["tool_calls"] = data["tool_calls"][:MAX_TOOL_CALLS]

    elif event_name == "PostToolUse":
        tool_name = payload.get("tool_name", "unknown")
        tool_response = payload.get("tool_response", {})

        # 找到最近一条同名 running 工具调用，标记完成
        for call in data["tool_calls"]:
            if call["tool"] == tool_name and call["status"] == "running":
                call["status"] = "done"
                call["finished_at"] = now()
                # 提取响应摘要
                call["response_summary"] = summarize_response(tool_name, tool_response)
                break

    elif event_name == "Stop":
        stop_reason = payload.get("stop_reason", "")
        data["session"]["status"] = "idle"

        # 把所有 running 的工具调用标记为 done
        for call in data["tool_calls"]:
            if call["status"] == "running":
                call["status"] = "done"
                call["finished_at"] = now()

        # 记录 stop 消息
        data["messages"].insert(0, {
            "role": "system",
            "content": f"Session 结束（{stop_reason}）",
            "timestamp": now(),
        })
        data["messages"] = data["messages"][:MAX_MESSAGES]

    elif event_name == "Notification":
        message = payload.get("message", "")
        data["messages"].insert(0, {
            "role": "assistant",
            "content": message,
            "timestamp": now(),
        })
        data["messages"] = data["messages"][:MAX_MESSAGES]

    elif event_name == "SessionStart":
        session_id = payload.get("session_id", "")
        data["session"] = {
            "id": session_id,
            "status": "running",
            "started_at": now(),
        }
        data["current_task"] = None
        data["tool_calls"] = []
        data["messages"] = [{
            "role": "system",
            "content": "Session 已开始",
            "timestamp": now(),
        }]

    save_data(data)


def summarize_tool(tool_name, tool_input):
    """为常见工具生成可读摘要"""
    if tool_name == "Read":
        path = tool_input.get("file_path", tool_input.get("path", ""))
        return f"读取文件：{path}"
    elif tool_name == "Write":
        path = tool_input.get("file_path", tool_input.get("path", ""))
        return f"写入文件：{path}"
    elif tool_name == "Edit":
        path = tool_input.get("file_path", tool_input.get("path", ""))
        return f"编辑文件：{path}"
    elif tool_name == "MultiEdit":
        path = tool_input.get("file_path", tool_input.get("path", ""))
        return f"批量编辑：{path}"
    elif tool_name == "Bash":
        cmd = tool_input.get("command", "")
        return f"执行命令：{cmd[:80]}{'...' if len(cmd) > 80 else ''}"
    elif tool_name == "Glob":
        pattern = tool_input.get("pattern", "")
        return f"搜索文件：{pattern}"
    elif tool_name == "Grep":
        pattern = tool_input.get("pattern", "")
        path = tool_input.get("path", "")
        return f"搜索内容：{pattern} 在 {path}"
    elif tool_name == "LS":
        path = tool_input.get("path", "")
        return f"列出目录：{path}"
    elif tool_name == "TodoWrite":
        return "更新 TODO 列表"
    elif tool_name == "WebSearch":
        query = tool_input.get("query", "")
        return f"搜索网络：{query}"
    elif tool_name == "WebFetch":
        url = tool_input.get("url", "")
        return f"抓取网页：{url}"
    else:
        return f"{tool_name}"


def summarize_response(tool_name, tool_response):
    """提取工具响应摘要"""
    if isinstance(tool_response, dict):
        if "error" in tool_response:
            return f"错误：{str(tool_response['error'])[:100]}"
        if "output" in tool_response:
            out = str(tool_response["output"])
            return out[:100] + ("..." if len(out) > 100 else "")
    if isinstance(tool_response, str):
        return tool_response[:100] + ("..." if len(tool_response) > 100 else "")
    return ""


def main():
    # 从环境变量或 stdin 读取事件
    event_name = os.environ.get("CLAUDE_HOOK_EVENT", "")
    
    if not event_name:
        # 兼容：从命令行参数读取
        if len(sys.argv) > 1:
            event_name = sys.argv[1]

    # 从 stdin 读取 JSON payload
    try:
        raw = sys.stdin.read().strip()
        payload = json.loads(raw) if raw else {}
    except Exception:
        payload = {}

    # 如果 payload 里有 hook_event_name 字段（Claude Code 格式）
    if not event_name and "hook_event_name" in payload:
        event_name = payload["hook_event_name"]

    if event_name:
        handle_event(event_name, payload)

    # Hook 脚本必须以 0 退出，否则 Claude Code 会报错
    sys.exit(0)


if __name__ == "__main__":
    main()
