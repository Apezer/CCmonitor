const DATA_URL = './data.json';
const POLL_INTERVAL = 500;

let lastDataStr = '';

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

function renderStatus(status) {
  const badge = document.getElementById('statusBadge');
  const text  = document.getElementById('statusText');
  badge.className = `status-badge ${status}`;
  const map = { running: '运行中', idle: '空闲', error: '出错' };
  text.textContent = map[status] || status;
}

function renderToolItem(call) {
  const icon = toolIcon(call.tool);
  const statusChar = call.status === 'running' ? '⟳' : call.status === 'error' ? '✕' : '✓';
  return `
    <div class="tool-item ${call.status}">
      <div class="tool-name">
        <div class="tool-icon ${icon.cls}">${icon.char}</div>
        <span class="tool-label">${escHtml(call.tool)}</span>
        <span class="tool-status-icon ${call.status}">${statusChar}</span>
      </div>
      ${call.summary ? `<div class="tool-summary" title="${escHtml(call.summary)}">${escHtml(call.summary)}</div>` : ''}
      <div class="tool-time">${fmtTime(call.started_at)}</div>
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

function escHtml(s) {
  return String(s)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

function render(data) {
  const sess = data.session || {};
  const tools = data.tool_calls || [];
  const msgs  = data.messages  || [];

  // Session
  renderStatus(sess.status || 'idle');
  const sidEl = document.getElementById('sessionId');
  const fullId = sess.id || '';
  sidEl.childNodes[0].textContent = shortId(fullId);
  sidEl.dataset.fullId = fullId;
  document.getElementById('sessionTip').textContent = fullId || '—';
  document.getElementById('sessionStart').textContent = fmtTime(sess.started_at);
  document.getElementById('sessionDuration').textContent =
    sess.status === 'running' ? fmtDuration(sess.started_at) : '—';

  // Current task
  const taskEl = document.getElementById('taskDisplay');
  if (data.current_task) {
    taskEl.className = 'task-text';
    taskEl.textContent = data.current_task;
  } else {
    taskEl.className = 'task-empty';
    taskEl.textContent = '暂无任务';
  }

  // Tools
  const toolList = document.getElementById('toolList');
  if (tools.length === 0) {
    toolList.innerHTML = '<div class="empty-state">等待工具调用…</div>';
  } else {
    toolList.innerHTML = tools.map(renderToolItem).join('');
  }

  // Stats
  document.getElementById('statTotal').textContent   = tools.length;
  document.getElementById('statRunning').textContent = tools.filter(t => t.status === 'running').length;
  document.getElementById('statDone').textContent    = tools.filter(t => t.status === 'done').length;
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

async function poll() {
  try {
    const res = await fetch(`${DATA_URL}?_=${Date.now()}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();

    document.getElementById('liveDot').className = 'live-dot';
    document.getElementById('errorBanner').className = 'error-banner';

    if (text !== lastDataStr) {
      lastDataStr = text;
      const data = JSON.parse(text);
      render(data);
    }

    // Update duration live even if data unchanged
    const startEl = document.getElementById('sessionStart');
    if (startEl.textContent !== '—') {
      try {
        const d = JSON.parse(lastDataStr);
        if (d.session?.status === 'running') {
          document.getElementById('sessionDuration').textContent =
            fmtDuration(d.session.started_at);
        }
      } catch(e) {}
    }

  } catch(e) {
    document.getElementById('liveDot').className = 'live-dot offline';
    document.getElementById('errorBanner').className = 'error-banner visible';
  }
}

poll();
setInterval(poll, POLL_INTERVAL);
