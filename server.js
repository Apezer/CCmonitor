const express = require('express');
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 9090;
const DB_PATH = path.join(__dirname, 'ccmonitor.db');
const MAX_TOOL_CALLS = 100;
const MAX_MESSAGES = 50;
const MAX_SESSIONS = 100;
const SSE_KEEPALIVE_MS = 30000;
const DB_SAVE_DEBOUNCE_MS = 500;
const PERMISSION_TIMEOUT_MS = 300000;

let db;

// ── Database ──────────────────────────────────────────────

function initDb(SQL) {
  const fileBuffer = fs.existsSync(DB_PATH) ? fs.readFileSync(DB_PATH) : null;
  db = fileBuffer ? new SQL.Database(fileBuffer) : new SQL.Database();

  db.run(`CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'idle', started_at TEXT NOT NULL, ended_at TEXT)`);
  db.run(`CREATE TABLE IF NOT EXISTS tool_calls (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, tool TEXT NOT NULL, input TEXT, status TEXT NOT NULL DEFAULT 'running', started_at TEXT NOT NULL, finished_at TEXT, summary TEXT, response_summary TEXT)`);
  db.run(`CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, timestamp TEXT NOT NULL)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_tool_calls_session ON tool_calls(session_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id)`);
  saveDbSync();
}

let saveTimer = null;
function saveDb() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => { saveTimer = null; saveDbSync(); }, DB_SAVE_DEBOUNCE_MS);
}
function saveDbSync() { fs.writeFileSync(DB_PATH, Buffer.from(db.export())); }

function queryAll(sql, params = []) {
  const stmt = db.prepare(sql); stmt.bind(params);
  const rows = []; while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free(); return rows;
}
function queryOne(sql, params = []) { const r = queryAll(sql, params); return r.length > 0 ? r[0] : null; }

function cleanupOldSessions() {
  const all = queryAll(`SELECT id FROM sessions ORDER BY started_at DESC`);
  if (all.length <= MAX_SESSIONS) return;
  const toDelete = all.slice(MAX_SESSIONS).map(s => s.id);
  const ph = toDelete.map(() => '?').join(',');
  db.run(`DELETE FROM tool_calls WHERE session_id IN (${ph})`, toDelete);
  db.run(`DELETE FROM messages WHERE session_id IN (${ph})`, toDelete);
  db.run(`DELETE FROM sessions WHERE id IN (${ph})`, toDelete);
  saveDb();
}

// ── Multi-Session State ───────────────────────────────────

const sessions = new Map();
let activeSessionId = null;

function createSessionState(sessionId) {
  return {
    session: { id: sessionId, status: 'running', started_at: now(), cwd: '' },
    activity: 'idle', activity_detail: '', pending_permission: null,
    current_task: null, tool_calls: [], messages: [],
  };
}

function getOrCreate(sessionId) {
  if (!sessions.has(sessionId)) sessions.set(sessionId, createSessionState(sessionId));
  return sessions.get(sessionId);
}

function now() { return new Date().toISOString(); }
function tryParseJson(s) { try { return JSON.parse(s); } catch { return {}; } }

function buildSessionData(s) {
  return {
    session: { ...s.session },
    activity: s.activity, activity_detail: s.activity_detail,
    pending_permission: s.pending_permission || null,
    current_task: s.current_task,
    tool_calls: s.tool_calls.slice(0, MAX_TOOL_CALLS),
    messages: s.messages.slice(0, MAX_MESSAGES),
  };
}

function buildState() {
  const sessionList = [];
  for (const [id, s] of sessions) {
    sessionList.push({
      id, status: s.session.status, started_at: s.session.started_at, cwd: s.session.cwd,
      tool_count: s.tool_calls.length, message_count: s.messages.length,
      current_task: s.current_task, activity: s.activity,
    });
  }
  const active = activeSessionId && sessions.has(activeSessionId) ? buildSessionData(sessions.get(activeSessionId)) : null;
  return { activeSessionId, sessions: sessionList, active, last_updated: now() };
}

function seedState() {
  const recent = queryAll(`SELECT * FROM sessions WHERE status = 'running' ORDER BY started_at DESC LIMIT 5`);
  for (const row of recent) {
    const s = createSessionState(row.id);
    s.session = { id: row.id, status: row.status, started_at: row.started_at, cwd: '' };
    s.tool_calls = queryAll(`SELECT * FROM tool_calls WHERE session_id = ? ORDER BY id DESC`, [row.id]).map(r => ({
      id: `db-${r.id}`, tool: r.tool, input: tryParseJson(r.input), status: r.status,
      started_at: r.started_at, finished_at: r.finished_at, summary: r.summary, response_summary: r.response_summary,
    }));
    s.messages = queryAll(`SELECT * FROM messages WHERE session_id = ? ORDER BY id DESC`, [row.id]).map(r => ({
      role: r.role, content: r.content, timestamp: r.timestamp,
    }));
    sessions.set(row.id, s);
  }
  if (recent.length > 0) activeSessionId = recent[0].id;
}

// ── SSE ───────────────────────────────────────────────────

const sseClients = new Set();

function broadcast() {
  const data = JSON.stringify(buildState());
  for (const res of sseClients) {
    try { res.write(`event: state_update\ndata: ${data}\n\n`); } catch { sseClients.delete(res); }
  }
}

setInterval(() => {
  for (const res of sseClients) {
    try { res.write(`:keepalive\n\n`); } catch { sseClients.delete(res); }
  }
}, SSE_KEEPALIVE_MS);

// ── Permission Requests ───────────────────────────────────

const pendingPermissions = new Map();
let permissionCounter = 0;

// ── Event Handlers ────────────────────────────────────────

function handleEvent(eventName, payload) {
  const ts = now();
  const sessionId = payload.session_id || activeSessionId || '';
  if (!sessionId && eventName !== 'SessionStart') return;

  if (eventName === 'SessionStart') {
    const sid = payload.session_id || '';
    const cwd = payload.cwd || '';
    db.run(`INSERT OR REPLACE INTO sessions (id, status, started_at) VALUES (?, ?, ?)`, [sid, 'running', ts]);
    const s = createSessionState(sid);
    s.session.cwd = cwd;
    s.messages = [{ role: 'system', content: 'Session 已开始', timestamp: ts }];
    sessions.set(sid, s);
    activeSessionId = sid;
    saveDb(); broadcast(); return;
  }

  const s = getOrCreate(sessionId);
  if (sessionId !== activeSessionId) activeSessionId = sessionId;

  if (eventName === 'SessionEnd') {
    db.run(`UPDATE sessions SET status = 'ended', ended_at = ? WHERE id = ?`, [ts, sessionId]);
    s.session.status = 'ended'; s.activity = 'idle'; s.activity_detail = '';
    db.run(`UPDATE tool_calls SET status = 'done', finished_at = ? WHERE session_id = ? AND status = 'running'`, [ts, sessionId]);
    s.tool_calls.forEach(c => { if (c.status === 'running') { c.status = 'done'; c.finished_at = ts; } });
    const msg = { role: 'system', content: 'Session 已终止', timestamp: ts };
    db.run(`INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)`, [sessionId, msg.role, msg.content, msg.timestamp]);
    s.messages.unshift(msg); s.messages = s.messages.slice(0, MAX_MESSAGES);
    saveDb(); broadcast(); return;
  }

  if (eventName === 'UserPromptSubmit') {
    const prompt = payload.prompt || '';
    s.session.status = 'running'; s.activity = 'thinking'; s.activity_detail = '';
    s.current_task = prompt || null;
    if (prompt) {
      const msg = { role: 'user', content: prompt, timestamp: ts };
      db.run(`INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)`, [sessionId, msg.role, msg.content, msg.timestamp]);
      s.messages.unshift(msg); s.messages = s.messages.slice(0, MAX_MESSAGES);
    }
    saveDb(); broadcast(); return;
  }

  if (eventName === 'PreToolUse') {
    const toolName = payload.tool_name || 'unknown';
    const toolInput = payload.tool_input || {};
    const cwd = payload.cwd || s.session.cwd || '';
    if (cwd) s.session.cwd = cwd;
    s.session.status = 'running'; s.activity = 'running'; s.activity_detail = toolName;
    const summary = summarizeTool(toolName, toolInput);
    db.run(`INSERT INTO tool_calls (session_id, tool, input, status, started_at, summary) VALUES (?, ?, ?, ?, ?, ?)`,
      [sessionId, toolName, JSON.stringify(toolInput), 'running', ts, summary]);
    const lastId = queryOne(`SELECT last_insert_rowid() as id`);
    const callId = lastId ? `db-${lastId.id}` : `${toolName}-${ts}`;
    s.tool_calls.unshift({ id: callId, tool: toolName, input: toolInput, status: 'running', started_at: ts, finished_at: null, summary });
    s.tool_calls = s.tool_calls.slice(0, MAX_TOOL_CALLS);
    saveDb(); broadcast(); return;
  }

  if (eventName === 'PostToolUse') {
    const toolName = payload.tool_name || 'unknown';
    const respSummary = summarizeResponse(payload.tool_response || {});
    db.run(`UPDATE tool_calls SET status = 'done', finished_at = ?, response_summary = ? WHERE session_id = ? AND tool = ? AND status = 'running'`,
      [ts, respSummary, sessionId, toolName]);
    const call = s.tool_calls.find(c => c.tool === toolName && c.status === 'running');
    if (call) { call.status = 'done'; call.finished_at = ts; call.response_summary = respSummary; }
    if (!s.tool_calls.some(c => c.status === 'running')) { s.activity = 'thinking'; s.activity_detail = ''; }
    saveDb(); broadcast(); return;
  }

  if (eventName === 'PostToolUseFailure') {
    const toolName = payload.tool_name || 'unknown';
    const errorMsg = payload.error || payload.error_message || '';
    const errText = errorMsg ? `错误：${String(errorMsg).slice(0, 100)}` : '';
    db.run(`UPDATE tool_calls SET status = 'error', finished_at = ?, response_summary = ? WHERE session_id = ? AND tool = ? AND status = 'running'`,
      [ts, errText, sessionId, toolName]);
    const call = s.tool_calls.find(c => c.tool === toolName && c.status === 'running');
    if (call) { call.status = 'error'; call.finished_at = ts; call.response_summary = errText; }
    s.activity = 'failed'; s.activity_detail = `${toolName} 失败`;
    saveDb(); broadcast(); return;
  }

  if (eventName === 'PermissionRequest') {
    const toolName = payload.tool_name || 'unknown';
    const toolInput = payload.tool_input || {};
    const permId = `perm-${++permissionCounter}-${Date.now()}`;
    s.activity = 'waiting'; s.activity_detail = `等待确认：${toolName}`;
    s.pending_permission = { id: permId, tool: toolName, input: toolInput };
    saveDb(); broadcast();
    return { holdResponse: true, permissionId: permId, toolName, toolInput };
  }

  if (eventName === 'PermissionDenied') {
    const toolName = payload.tool_name || 'unknown';
    const msg = { role: 'system', content: `权限被拒绝：${toolName}`, timestamp: ts };
    db.run(`INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)`, [sessionId, msg.role, msg.content, msg.timestamp]);
    s.messages.unshift(msg); s.messages = s.messages.slice(0, MAX_MESSAGES);
    const call = s.tool_calls.find(c => c.tool === toolName && c.status === 'running');
    if (call) { call.status = 'error'; call.finished_at = ts; call.response_summary = '权限被拒绝'; }
    s.activity = 'thinking'; s.activity_detail = '';
    saveDb(); broadcast(); return;
  }

  if (eventName === 'Stop') {
    db.run(`UPDATE sessions SET status = 'idle', ended_at = ? WHERE id = ?`, [ts, sessionId]);
    db.run(`UPDATE tool_calls SET status = 'done', finished_at = ? WHERE session_id = ? AND status = 'running'`, [ts, sessionId]);
    s.session.status = 'idle'; s.activity = 'idle'; s.activity_detail = ''; s.current_task = null;
    s.tool_calls.forEach(c => { if (c.status === 'running') { c.status = 'done'; c.finished_at = ts; } });
    const stopReason = payload.stop_reason || '';
    const msg = { role: 'system', content: `响应完成（${stopReason}）`, timestamp: ts };
    db.run(`INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)`, [sessionId, msg.role, msg.content, msg.timestamp]);
    s.messages.unshift(msg); s.messages = s.messages.slice(0, MAX_MESSAGES);
    saveDb(); broadcast(); return;
  }

  if (eventName === 'StopFailure') {
    const errorMsg = payload.error || payload.error_message || '';
    s.activity = 'failed'; s.activity_detail = errorMsg ? `API 错误：${String(errorMsg).slice(0, 80)}` : 'API 错误';
    const msg = { role: 'system', content: `响应异常终止：${errorMsg}`, timestamp: ts };
    db.run(`INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)`, [sessionId, msg.role, msg.content, msg.timestamp]);
    s.messages.unshift(msg); s.messages = s.messages.slice(0, MAX_MESSAGES);
    saveDb(); broadcast(); return;
  }

  if (eventName === 'Notification') {
    const message = payload.message || '';
    const msg = { role: 'assistant', content: message, timestamp: ts };
    db.run(`INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)`, [sessionId, msg.role, msg.content, msg.timestamp]);
    s.messages.unshift(msg); s.messages = s.messages.slice(0, MAX_MESSAGES);
    saveDb(); broadcast(); return;
  }

  if (eventName === 'SubagentStart') {
    const agentType = payload.agent_type || '';
    s.activity = 'subagent'; s.activity_detail = agentType ? `子代理：${agentType}` : '子代理运行中';
    const msg = { role: 'system', content: `子代理启动${agentType ? `（${agentType}）` : ''}`, timestamp: ts };
    db.run(`INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)`, [sessionId, msg.role, msg.content, msg.timestamp]);
    s.messages.unshift(msg); s.messages = s.messages.slice(0, MAX_MESSAGES);
    saveDb(); broadcast(); return;
  }

  if (eventName === 'SubagentStop') {
    s.activity = 'thinking'; s.activity_detail = '';
    const agentType = payload.agent_type || '';
    const msg = { role: 'system', content: `子代理完成${agentType ? `（${agentType}）` : ''}`, timestamp: ts };
    db.run(`INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)`, [sessionId, msg.role, msg.content, msg.timestamp]);
    s.messages.unshift(msg); s.messages = s.messages.slice(0, MAX_MESSAGES);
    saveDb(); broadcast(); return;
  }

  if (eventName === 'PreCompact') { s.activity = 'compacting'; s.activity_detail = '压缩上下文...'; saveDb(); broadcast(); return; }
  if (eventName === 'PostCompact') { s.activity = 'thinking'; s.activity_detail = ''; saveDb(); broadcast(); return; }
}

// ── Summarize Helpers ─────────────────────────────────────

function summarizeTool(toolName, toolInput) {
  const t = toolName;
  if (t === 'Read') return `读取文件：${toolInput.file_path || toolInput.path || ''}`;
  if (t === 'Write') return `写入文件：${toolInput.file_path || toolInput.path || ''}`;
  if (t === 'Edit') return `编辑文件：${toolInput.file_path || toolInput.path || ''}`;
  if (t === 'MultiEdit') return `批量编辑：${toolInput.file_path || toolInput.path || ''}`;
  if (t === 'Bash') { const cmd = toolInput.command || ''; return `执行命令：${cmd.slice(0, 80)}${cmd.length > 80 ? '...' : ''}`; }
  if (t === 'Glob') return `搜索文件：${toolInput.pattern || ''}`;
  if (t === 'Grep') return `搜索内容：${toolInput.pattern || ''} 在 ${toolInput.path || ''}`;
  if (t === 'LS') return `列出目录：${toolInput.path || ''}`;
  if (t === 'TodoWrite') return '更新 TODO 列表';
  if (t === 'WebSearch') return `搜索网络：${toolInput.query || ''}`;
  if (t === 'WebFetch') return `抓取网页：${toolInput.url || ''}`;
  return t;
}

function summarizeResponse(resp) {
  if (typeof resp === 'object' && resp !== null) {
    if (resp.error) return `错误：${String(resp.error).slice(0, 100)}`;
    if (resp.output) return String(resp.output).slice(0, 100) + (String(resp.output).length > 100 ? '...' : '');
  }
  if (typeof resp === 'string') return resp.slice(0, 100) + (resp.length > 100 ? '...' : '');
  return '';
}

// ── Routes ────────────────────────────────────────────────

app.use(express.json());
app.use(express.static(path.join(__dirname, 'frontend')));

app.post('/api/event', (req, res) => {
  const { event_name, payload } = req.body;
  if (event_name) handleEvent(event_name, payload || {});
  res.json({ ok: true });
});

app.post('/hooks/claude', (req, res) => {
  const payload = req.body;
  const eventName = payload.hook_event_name || '';

  if (eventName === 'PermissionRequest') {
    const toolName = payload.tool_name || 'unknown';
    const toolInput = payload.tool_input || {};
    const permId = `perm-${++permissionCounter}-${Date.now()}`;
    const sessionId = payload.session_id || activeSessionId || '';
    const s = sessionId ? getOrCreate(sessionId) : null;
    if (s) { s.activity = 'waiting'; s.activity_detail = `等待确认：${toolName}`; s.pending_permission = { id: permId, tool: toolName, input: toolInput }; }
    broadcast();

    const permissionPromise = new Promise((resolve) => {
      const timeout = setTimeout(() => {
        pendingPermissions.delete(permId);
        if (s) { s.activity = 'thinking'; s.activity_detail = ''; s.pending_permission = null; }
        broadcast();
        resolve({ behavior: 'deny', message: 'Timeout' });
      }, PERMISSION_TIMEOUT_MS);
      pendingPermissions.set(permId, { resolve, timeout, toolName, toolInput });
    });

    permissionPromise.then((decision) => {
      res.json({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: decision.behavior, message: decision.message || '' } } });
    });
    return;
  }

  if (eventName) handleEvent(eventName, payload);
  res.json({ ok: true });
});

app.post('/api/permission/:id', (req, res) => {
  const permId = req.params.id;
  const { decision, message } = req.body;
  const pending = pendingPermissions.get(permId);
  if (!pending) return res.status(404).json({ error: 'Permission request not found or expired' });
  clearTimeout(pending.timeout);
  pendingPermissions.delete(permId);
  // Clear waiting state on the session that had the permission
  for (const [, s] of sessions) {
    if (s.pending_permission && s.pending_permission.id === permId) {
      s.activity = 'thinking'; s.activity_detail = ''; s.pending_permission = null;
    }
  }
  broadcast();
  pending.resolve({ behavior: decision || 'deny', message: message || '' });
  res.json({ ok: true });
});

app.get('/api/permissions', (req, res) => {
  const list = [];
  for (const [id, p] of pendingPermissions) list.push({ id, tool: p.toolName, input: p.toolInput });
  res.json(list);
});

app.get('/api/events', (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
  res.write(`event: state_update\ndata: ${JSON.stringify(buildState())}\n\n`);
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});

app.post('/api/active-session', (req, res) => {
  const { sessionId } = req.body;
  if (sessionId && sessions.has(sessionId)) {
    activeSessionId = sessionId;
    broadcast();
    res.json({ ok: true });
  } else {
    res.status(404).json({ error: 'Session not found' });
  }
});

app.get('/api/sessions', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const rows = queryAll(`SELECT s.*, (SELECT COUNT(*) FROM tool_calls WHERE session_id = s.id) as tool_count, (SELECT COUNT(*) FROM messages WHERE session_id = s.id) as message_count FROM sessions s ORDER BY started_at DESC LIMIT ?`, [limit]);
  res.json(rows);
});

app.get('/api/sessions/:id', (req, res) => {
  const session = queryOne(`SELECT * FROM sessions WHERE id = ?`, [req.params.id]);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  const toolCalls = queryAll(`SELECT * FROM tool_calls WHERE session_id = ? ORDER BY id DESC`, [req.params.id]);
  const messages = queryAll(`SELECT * FROM messages WHERE session_id = ? ORDER BY id DESC`, [req.params.id]);
  res.json({ ...session, tool_calls: toolCalls, messages });
});

// ── Start ─────────────────────────────────────────────────

async function main() {
  const SQL = await initSqlJs();
  initDb(SQL);
  cleanupOldSessions();
  seedState();
  app.listen(PORT, '0.0.0.0', () => { console.log(`CCmonitor server running at http://localhost:${PORT}`); });
}

main().catch(err => { console.error('Failed to start:', err); process.exit(1); });
process.on('SIGINT', () => { if (saveTimer) { clearTimeout(saveTimer); saveDbSync(); } process.exit(0); });
process.on('SIGTERM', () => { if (saveTimer) { clearTimeout(saveTimer); saveDbSync(); } process.exit(0); });
