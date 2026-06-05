// Theme management
const THEMES = [
  { id: 'dark',  label: 'Dark',  color: '#4d9fff' },
  { id: 'light', label: 'Light', color: '#2563eb' },
  { id: 'green', label: 'Matrix', color: '#00ff88' },
  { id: 'amber', label: 'Amber', color: '#ffb340' },
];

function initTheme() {
  const saved = localStorage.getItem('ccmonitor-theme') || 'dark';
  applyTheme(saved);

  const dropdown = document.getElementById('themeDropdown');
  THEMES.forEach(t => {
    const opt = document.createElement('div');
    opt.className = 'theme-option' + (t.id === saved ? ' active' : '');
    opt.dataset.theme = t.id;
    opt.innerHTML = `<div class="theme-option-dot" style="background:${t.color}"></div>${t.label}`;
    opt.addEventListener('click', () => {
      applyTheme(t.id);
      localStorage.setItem('ccmonitor-theme', t.id);
      dropdown.classList.remove('open');
      dropdown.querySelectorAll('.theme-option').forEach(o => o.classList.remove('active'));
      opt.classList.add('active');
    });
    dropdown.appendChild(opt);
  });

  document.getElementById('themeBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    dropdown.classList.toggle('open');
  });
  document.addEventListener('click', () => dropdown.classList.remove('open'));
}

function applyTheme(id) {
  const theme = THEMES.find(t => t.id === id) || THEMES[0];
  document.documentElement.setAttribute('data-theme', id === 'dark' ? '' : id);
  if (id === 'dark') document.documentElement.removeAttribute('data-theme');
  document.getElementById('themeLabel').textContent = theme.label;
  document.getElementById('themeDot').style.background = theme.color;
}

initTheme();

// Click-to-copy for session ID
document.getElementById('sessionId').addEventListener('click', function() {
  const id = this.dataset.fullId;
  if (!id) return;
  navigator.clipboard.writeText(id).then(() => {
    const toast = document.getElementById('copyToast');
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 1500);
  });
});

// ── Utility Functions ─────────────────────────────────────

function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleTimeString('zh-CN', { hour12: false });
}

function fmtDuration(startIso) {
  if (!startIso) return '—';
  const secs = Math.floor((Date.now() - new Date(startIso)) / 1000);
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs/60)}m ${secs%60}s`;
  return `${Math.floor(secs/3600)}h ${Math.floor((secs%3600)/60)}m`;
}

function fmtDurationMs(startIso, endIso) {
  if (!startIso || !endIso) return '';
  const ms = new Date(endIso) - new Date(startIso);
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms/1000).toFixed(1)}s`;
  return `${Math.floor(ms/60000)}m ${Math.floor((ms%60000)/1000)}s`;
}

function shortId(id) {
  if (!id) return '—';
  return id.length > 12 ? id.slice(0,8) + '…' : id;
}

function toolIcon(toolName) {
  const t = toolName.toLowerCase();
  if (t === 'read') return { cls: 'read', char: 'R' };
  if (['write','edit','multiedit'].includes(t)) return { cls: 'write', char: 'W' };
  if (t === 'bash') return { cls: 'bash', char: '>' };
  if (['glob','grep','ls'].includes(t)) return { cls: 'search', char: 'S' };
  return { cls: 'other', char: '?' };
}

function escHtml(s) {
  return String(s)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

// ── Render Functions ──────────────────────────────────────

function renderStatus(status) {
  const badge = document.getElementById('statusBadge');
  const text  = document.getElementById('statusText');
  // Map ended to idle for badge display
  const displayStatus = status === 'ended' ? 'idle' : status;
  badge.className = `status-badge ${displayStatus}`;
  const map = { running: '运行中', idle: '空闲', error: '出错', ended: '已终止' };
  text.textContent = map[status] || status;
}

function renderToolItem(call) {
  const icon = toolIcon(call.tool);
  const statusChar = call.status === 'running' ? '⟳' : call.status === 'error' ? '✕' : '✓';
  const dur = fmtDurationMs(call.started_at, call.finished_at);
  const inputStr = call.input ? JSON.stringify(call.input, null, 2) : '';
  const respStr = call.response_summary || '';

  return `
    <div class="tool-item ${call.status}" onclick="this.classList.toggle('expanded')">
      <div class="tool-name">
        <div class="tool-icon ${icon.cls}">${icon.char}</div>
        <span class="tool-label">${escHtml(call.tool)}</span>
        ${dur ? `<span class="tool-time" style="margin-left:auto;padding:0;font-size:10px;color:var(--text-faint)">${dur}</span>` : ''}
        <span class="tool-status-icon ${call.status}">${statusChar}</span>
      </div>
      ${call.summary ? `<div class="tool-summary" title="${escHtml(call.summary)}">${escHtml(call.summary)}</div>` : ''}
      <div class="tool-detail">
        ${inputStr ? `<div class="tool-detail-label">Input</div><pre>${escHtml(inputStr)}</pre>` : ''}
        ${respStr ? `<div class="tool-detail-label response-text">Response</div><pre class="response-text">${escHtml(respStr)}</pre>` : ''}
      </div>
    </div>`;
}

function roleLabel(role) {
  return { assistant: 'Claude', system: 'System', user: 'User' }[role] || role;
}

function roleAvatarChar(role) {
  return { assistant: 'C', system: 'S', user: 'U' }[role] || '?';
}

function renderMessage(msg) {
  const role = msg.role || 'system';
  return `
    <div class="msg-item">
      <div class="msg-avatar ${role}">${roleAvatarChar(role)}</div>
      <div class="msg-body">
        <div class="msg-meta">
          <span class="msg-role ${role}">${roleLabel(role)}</span>
          <span class="msg-time">${fmtTime(msg.timestamp)}</span>
        </div>
        <div class="msg-content">${escHtml(msg.content || '')}</div>
      </div>
    </div>`;
}

// ── Search & Filter ───────────────────────────────────────

let filterType = 'all';
let searchQuery = '';
let currentData = null;
let viewingHistory = false;
let sseConnection = null;

function filterTools(tools) {
  return tools.filter(t => {
    if (filterType !== 'all' && t.tool.toLowerCase() !== filterType) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const matchTool = t.tool.toLowerCase().includes(q);
      const matchSummary = (t.summary || '').toLowerCase().includes(q);
      const matchInput = JSON.stringify(t.input || {}).toLowerCase().includes(q);
      if (!matchTool && !matchSummary && !matchInput) return false;
    }
    return true;
  });
}

function initSearchFilter() {
  const searchInput = document.getElementById('toolSearch');
  let debounceTimer;

  searchInput.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      searchQuery = searchInput.value.trim();
      if (currentData) render(currentData);
    }, 200);
  });

  document.getElementById('filterBtns').addEventListener('click', (e) => {
    const btn = e.target.closest('.filter-btn');
    if (!btn) return;
    filterType = btn.dataset.type;
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    if (currentData) render(currentData);
  });
}

// ── History Panel ─────────────────────────────────────────

function initHistory() {
  const historyBtn = document.getElementById('historyBtn');
  const historyClose = document.getElementById('historyClose');
  const historyBack = document.getElementById('historyBack');

  historyBtn.addEventListener('click', loadHistory);
  historyClose.addEventListener('click', () => {
    document.getElementById('historyPanel').classList.remove('open');
  });
  historyBack.addEventListener('click', returnToLive);
}

async function loadHistory() {
  const panel = document.getElementById('historyPanel');
  const list = document.getElementById('historyList');

  try {
    const res = await fetch('/api/sessions?limit=50');
    const sessions = await res.json();

    if (sessions.length === 0) {
      list.innerHTML = '<div class="empty-state">暂无历史会话</div>';
    } else {
      list.innerHTML = sessions.map(s => {
        const statusCls = s.status === 'running' ? 'running' : 'idle';
        const statusText = s.status === 'running' ? '运行中' : '已结束';
        const time = fmtTime(s.started_at);
        const endStr = s.ended_at ? ` → ${fmtTime(s.ended_at)}` : '';
        return `
          <div class="history-item" data-id="${escHtml(s.id)}">
            <div class="history-item-status ${statusCls}">${statusText}</div>
            <div class="history-item-time">${time}${endStr}</div>
            <div class="history-item-meta">${s.tool_count || 0} 工具调用 · ${s.message_count || 0} 消息 · ${escHtml(shortId(s.id))}</div>
          </div>`;
      }).join('');
    }

    panel.classList.add('open');

    // Bind click events
    list.querySelectorAll('.history-item').forEach(item => {
      item.addEventListener('click', () => loadSessionDetail(item.dataset.id));
    });
  } catch (e) {
    list.innerHTML = '<div class="empty-state">加载失败</div>';
    panel.classList.add('open');
  }
}

async function loadSessionDetail(sessionId) {
  try {
    const res = await fetch(`/api/sessions/${sessionId}`);
    const session = await res.json();

    // Close history panel
    document.getElementById('historyPanel').classList.remove('open');

    // Show back button
    document.getElementById('historyBack').classList.add('visible');

    // Disconnect SSE while viewing history
    viewingHistory = true;

    // Render the historical session
    const data = {
      session: { id: session.id, status: session.status, started_at: session.started_at },
      current_task: null,
      tool_calls: (session.tool_calls || []).map(t => ({
        id: `hist-${t.id}`, tool: t.tool, input: tryParseJson(t.input), status: t.status,
        started_at: t.started_at, finished_at: t.finished_at, summary: t.summary, response_summary: t.response_summary,
      })),
      messages: (session.messages || []).map(m => ({ role: m.role, content: m.content, timestamp: m.timestamp })),
      last_updated: session.started_at,
    };
    render(data);

    // Update header to show history mode
    document.getElementById('liveDot').className = 'live-dot offline';
  } catch (e) {
    console.error('Failed to load session:', e);
  }
}

function tryParseJson(s) { try { return JSON.parse(s); } catch { return {}; } }

function returnToLive() {
  viewingHistory = false;
  document.getElementById('historyBack').classList.remove('visible');
  // SSE will auto-reconnect and push the current state
}

// ── Mobile Menu ───────────────────────────────────────────

function initMobile() {
  const menuBtn = document.getElementById('menuBtn');
  const overlay = document.getElementById('mobileOverlay');
  const panel = document.getElementById('sessionPanel');

  menuBtn.addEventListener('click', () => {
    panel.classList.toggle('open');
    overlay.classList.toggle('open');
  });

  overlay.addEventListener('click', () => {
    panel.classList.remove('open');
    overlay.classList.remove('open');
  });
}

// ── Permission Panel ──────────────────────────────────────

let currentPermissionId = null;

function renderPermission(perm) {
  const panel = document.getElementById('permissionPanel');
  if (!perm) {
    panel.classList.remove('visible');
    currentPermissionId = null;
    return;
  }

  currentPermissionId = perm.id;
  document.getElementById('permTool').textContent = perm.tool || 'Unknown';

  const input = perm.input || {};
  const inputStr = Object.entries(input).map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`).join('\n');
  document.getElementById('permDetail').textContent = inputStr || '';

  panel.classList.add('visible');
}

function initPermissionButtons() {
  document.getElementById('permAllow').addEventListener('click', () => submitPermission('allow'));
  document.getElementById('permDeny').addEventListener('click', () => submitPermission('deny'));
}

async function submitPermission(decision) {
  if (!currentPermissionId) return;

  const btn = document.getElementById(decision === 'allow' ? 'permAllow' : 'permDeny');
  btn.textContent = '...';
  btn.disabled = true;

  try {
    await fetch(`/api/permission/${currentPermissionId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision })
    });
  } catch (e) {
    console.error('Failed to submit permission:', e);
  }

  document.getElementById('permissionPanel').classList.remove('visible');
  currentPermissionId = null;

  // Reset button text
  document.getElementById('permAllow').textContent = 'Allow';
  document.getElementById('permAllow').disabled = false;
  document.getElementById('permDeny').textContent = 'Deny';
  document.getElementById('permDeny').disabled = false;
}

// ── Main Render ───────────────────────────────────────────

const ACTIVITY_MAP = {
  idle: '空闲',
  thinking: '思考中',
  running: '执行中',
  waiting: '等待确认',
  subagent: '子代理运行中',
  compacting: '压缩上下文',
  failed: '执行失败',
};

function renderActivity(activity, detail) {
  const bar = document.getElementById('activityBar');
  const text = document.getElementById('activityText');
  bar.className = `activity-bar ${activity || 'idle'}`;
  const label = ACTIVITY_MAP[activity] || '空闲';
  text.textContent = detail ? `${label} — ${detail}` : label;
}

function render(data) {
  currentData = data;
  const sess = data.session || {};
  const allTools = data.tool_calls || [];
  const tools = filterTools(allTools);
  const msgs  = data.messages  || [];

  // Activity
  renderActivity(data.activity, data.activity_detail);

  // Permission panel
  renderPermission(data.pending_permission);

  // Session
  renderStatus(sess.status || 'idle');
  const sidEl = document.getElementById('sessionId');
  const fullId = sess.id || '';
  sidEl.childNodes[0].textContent = shortId(fullId);
  sidEl.dataset.fullId = fullId;
  document.getElementById('sessionTip').textContent = fullId || '—';
  document.getElementById('sessionStart').textContent = fmtTime(sess.started_at);
  const startEl = document.getElementById('sessionStart');
  startEl.dataset.startTime = sess.started_at || '';
  document.getElementById('sessionDuration').textContent =
    sess.status === 'running' ? fmtDuration(sess.started_at) : '—';

  // Working directory
  const cwdEl = document.getElementById('sessionCwd');
  const cwd = sess.cwd || '';
  cwdEl.textContent = cwd || '—';
  cwdEl.title = cwd ? '点击复制' : '';
  cwdEl.style.cursor = cwd ? 'pointer' : 'default';
  cwdEl.onclick = cwd ? () => {
    navigator.clipboard.writeText(cwd).then(() => {
      const toast = document.getElementById('copyToast');
      toast.textContent = '已复制工作目录';
      toast.classList.add('show');
      setTimeout(() => { toast.classList.remove('show'); toast.textContent = '已复制 Session ID'; }, 1500);
    });
  } : null;

  // Current task
  const taskEl = document.getElementById('taskDisplay');
  if (data.current_task) {
    taskEl.className = 'task-text';
    taskEl.textContent = data.current_task;
  } else {
    taskEl.className = 'task-empty';
    taskEl.textContent = '暂无任务';
  }

  // Tools (filtered)
  const toolList = document.getElementById('toolList');
  if (tools.length === 0) {
    const msg = allTools.length > 0 ? '无匹配结果' : '等待工具调用…';
    toolList.innerHTML = `<div class="empty-state">${msg}</div>`;
  } else {
    toolList.innerHTML = tools.map(renderToolItem).join('');
  }

  // Stats (use unfiltered counts)
  document.getElementById('statTotal').textContent   = allTools.length;
  document.getElementById('statRunning').textContent = allTools.filter(t => t.status === 'running').length;
  document.getElementById('statDone').textContent    = allTools.filter(t => t.status === 'done').length;
  document.getElementById('statMsgs').textContent    = msgs.length;

  // Messages
  const msgList = document.getElementById('messagesList');
  if (msgs.length === 0) {
    msgList.innerHTML = '<div class="empty-state">等待消息…</div>';
  } else {
    msgList.innerHTML = msgs.map(renderMessage).join('');
  }

  // Last updated
  document.getElementById('lastUpdated').textContent =
    data.last_updated ? `最后更新：${new Date(data.last_updated).toLocaleTimeString('zh-CN', {hour12:false})}` : '';
}

// ── SSE Connection ────────────────────────────────────────

function connectSSE() {
  const es = new EventSource('/api/events');
  sseConnection = es;

  es.addEventListener('state_update', (e) => {
    if (viewingHistory) return; // Don't update while viewing history
    const data = JSON.parse(e.data);
    render(data);
    document.getElementById('liveDot').className = 'live-dot';
    document.getElementById('errorBanner').className = 'error-banner';
  });

  es.onerror = () => {
    document.getElementById('liveDot').className = 'live-dot offline';
    document.getElementById('errorBanner').className = 'error-banner visible';
  };
}

// ── Init ──────────────────────────────────────────────────

initSearchFilter();
initHistory();
initMobile();
initPermissionButtons();
connectSSE();

// Live duration ticker
setInterval(() => {
  const startEl = document.getElementById('sessionStart');
  if (startEl.textContent !== '—') {
    const startTime = startEl.dataset.startTime;
    if (startTime) {
      document.getElementById('sessionDuration').textContent = fmtDuration(startTime);
    }
  }
}, 1000);
