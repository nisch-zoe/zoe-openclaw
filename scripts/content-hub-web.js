#!/usr/bin/env node

const http = require('http');
const fs = require('fs');
const path = require('path');

const WORKSPACE = path.resolve(__dirname, '..');
const OPENCLAW_HOME = path.resolve(WORKSPACE, '..');
const CONTENT_ROOT = path.join(OPENCLAW_HOME, 'knowledge', 'content');
const ITEMS_ROOT = path.join(CONTENT_ROOT, 'items');
const INDEX_PATH = path.join(OPENCLAW_HOME, 'workspace', 'state', 'content-hub', 'index.json');
const IDEAS_PATH = path.join(CONTENT_ROOT, 'IDEAS.md');

const PORT = parseInt(process.env.PORT || '3456', 10);
const HOST = process.env.HOST || '0.0.0.0';

function readIndex() {
  return JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
}

function readFileContent(relativePath) {
  const full = path.join(OPENCLAW_HOME, relativePath);
  if (!full.startsWith(OPENCLAW_HOME)) return null;
  if (!fs.existsSync(full)) return null;
  return fs.readFileSync(full, 'utf8');
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function stateColor(state) {
  const colors = {
    idea: '#6b7280',
    drafting: '#f59e0b',
    review: '#3b82f6',
    changes_requested: '#ef4444',
    approved: '#10b981',
    posted: '#8b5cf6',
    rejected: '#dc2626',
    archived: '#9ca3af',
  };
  return colors[state] || '#6b7280';
}

function platformIcon(platform) {
  const icons = { x: '𝕏', linkedin: 'in', reddit: 'r/' };
  return icons[platform] || platform;
}

function renderMarkdown(md) {
  let html = escapeHtml(md);
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');
  html = html.replace(/^---$/gm, '<hr>');
  html = html.replace(/\n{2,}/g, '</p><p>');
  html = '<p>' + html + '</p>';
  html = html.replace(/<p>\s*(<h[1-3]>)/g, '$1');
  html = html.replace(/(<\/h[1-3]>)\s*<\/p>/g, '$1');
  html = html.replace(/<p>\s*(<ul>)/g, '$1');
  html = html.replace(/(<\/ul>)\s*<\/p>/g, '$1');
  html = html.replace(/<p>\s*(<hr>)\s*<\/p>/g, '$1');
  html = html.replace(/<p>\s*<\/p>/g, '');
  return html;
}

const PAGE_SHELL = (title, body, backLink) => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<title>${escapeHtml(title)}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#0f0f0f;--surface:#1a1a1a;--surface2:#242424;--border:#2a2a2a;
  --text:#e5e5e5;--text2:#a3a3a3;--accent:#f59e0b;--accent2:#d97706;
}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
  background:var(--bg);color:var(--text);line-height:1.6;
  -webkit-font-smoothing:antialiased;min-height:100dvh}
.container{max-width:720px;margin:0 auto;padding:16px}
header{display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid var(--border);margin-bottom:16px}
header h1{font-size:1.1rem;font-weight:600;flex:1}
header a{color:var(--text2);text-decoration:none;font-size:.9rem;display:flex;align-items:center;gap:4px}
header a:hover{color:var(--text)}
.back-arrow{font-size:1.2rem}

.stats-row{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px}
.stat-chip{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:8px 14px;font-size:.8rem;color:var(--text2)}
.stat-chip strong{color:var(--text);font-size:1rem;display:block}

.filter-bar{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px;padding:8px 0}
.filter-btn{background:var(--surface);border:1px solid var(--border);border-radius:20px;
  padding:6px 14px;color:var(--text2);font-size:.8rem;cursor:pointer;transition:.15s}
.filter-btn:hover,.filter-btn.active{background:var(--accent);color:#000;border-color:var(--accent)}
.filter-btn .count{opacity:.6;margin-left:4px}

.search-box{width:100%;padding:10px 14px;background:var(--surface);border:1px solid var(--border);
  border-radius:10px;color:var(--text);font-size:.95rem;margin-bottom:12px;outline:none}
.search-box:focus{border-color:var(--accent)}
.search-box::placeholder{color:var(--text2)}

.item-list{list-style:none}
.item-card{background:var(--surface);border:1px solid var(--border);border-radius:12px;
  padding:14px 16px;margin-bottom:8px;cursor:pointer;transition:.15s;display:block;
  text-decoration:none;color:inherit}
.item-card:hover{border-color:var(--accent);background:var(--surface2)}
.item-card:active{transform:scale(.99)}
.item-title{font-size:.95rem;font-weight:600;margin-bottom:6px;line-height:1.3}
.item-meta{display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:.75rem;color:var(--text2)}
.state-badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:.7rem;
  font-weight:600;text-transform:uppercase;letter-spacing:.03em;color:#000}
.platform-badge{background:var(--surface2);padding:2px 7px;border-radius:6px;font-size:.7rem;font-weight:600}
.word-count{opacity:.7}
.item-excerpt{font-size:.8rem;color:var(--text2);margin-top:6px;line-height:1.4;
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}

.detail-header{margin-bottom:20px}
.detail-header h1{font-size:1.3rem;font-weight:700;line-height:1.3;margin-bottom:10px}
.detail-meta{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:8px}
.detail-intent{font-size:.85rem;color:var(--text2);line-height:1.5;margin-top:8px;
  padding:12px;background:var(--surface);border-radius:8px;border-left:3px solid var(--accent)}

.tab-bar{display:flex;gap:0;border-bottom:1px solid var(--border);margin:16px 0;overflow-x:auto;-webkit-overflow-scrolling:touch}
.tab{padding:10px 16px;font-size:.85rem;color:var(--text2);cursor:pointer;
  border-bottom:2px solid transparent;white-space:nowrap;transition:.15s}
.tab:hover{color:var(--text)}
.tab.active{color:var(--accent);border-bottom-color:var(--accent)}
.tab-panel{display:none}
.tab-panel.active{display:block}

.content-body{font-size:.9rem;line-height:1.7;padding:4px 0}
.content-body h1{font-size:1.2rem;font-weight:700;margin:20px 0 8px}
.content-body h2{font-size:1.05rem;font-weight:600;margin:18px 0 6px;color:var(--accent)}
.content-body h3{font-size:.95rem;font-weight:600;margin:14px 0 4px}
.content-body p{margin:8px 0}
.content-body ul{padding-left:20px;margin:8px 0}
.content-body li{margin:4px 0}
.content-body code{background:var(--surface2);padding:2px 6px;border-radius:4px;font-size:.85em}
.content-body strong{color:var(--text);font-weight:600}
.content-body hr{border:none;border-top:1px solid var(--border);margin:16px 0}

.channel-card{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:14px;margin-bottom:10px}
.channel-card h3{font-size:.9rem;font-weight:600;margin-bottom:8px;display:flex;align-items:center;gap:8px}
.channel-meta{font-size:.75rem;color:var(--text2);margin-bottom:8px}
.channel-meta span{margin-right:12px}

.empty-state{text-align:center;padding:40px 20px;color:var(--text2);font-size:.9rem}

.ideas-link{display:block;background:var(--surface);border:1px solid var(--border);border-radius:12px;
  padding:14px 16px;margin-bottom:16px;text-decoration:none;color:var(--text);transition:.15s}
.ideas-link:hover{border-color:var(--accent)}
.ideas-link strong{display:block;margin-bottom:4px}
.ideas-link span{font-size:.8rem;color:var(--text2)}
</style>
</head>
<body>
<div class="container">
<header>
  ${backLink ? `<a href="${backLink}"><span class="back-arrow">&larr;</span></a>` : ''}
  <h1>${escapeHtml(title)}</h1>
</header>
${body}
</div>
</body>
</html>`;

function renderListPage(index) {
  const { counts, items } = index;
  const states = Object.entries(counts.baseStates).filter(([, v]) => v > 0);
  const platforms = Object.entries(counts.channelsByPlatform);

  let body = '';

  body += `<div class="stats-row">
    <div class="stat-chip"><strong>${counts.totalItems}</strong>items</div>
    ${platforms.map(([p, c]) => `<div class="stat-chip"><strong>${c}</strong>${platformIcon(p)}</div>`).join('')}
  </div>`;

  body += `<input class="search-box" type="text" placeholder="Search titles..." id="search" autocomplete="off">`;

  body += `<div class="filter-bar" id="filters">
    <button class="filter-btn active" data-state="all">All<span class="count">${counts.totalItems}</span></button>
    ${states.map(([s, c]) => `<button class="filter-btn" data-state="${s}">${s.replace(/_/g, ' ')}<span class="count">${c}</span></button>`).join('')}
  </div>`;

  body += `<a class="ideas-link" href="/ideas"><strong>Ideas Board</strong><span>Browse content ideas and angles</span></a>`;

  body += `<ul class="item-list" id="items">`;
  for (const item of items) {
    const badges = (item.platforms || []).map(p => `<span class="platform-badge">${platformIcon(p)}</span>`).join('');
    const words = item.draftStats?.words || 0;
    body += `<a class="item-card" href="/item/${encodeURIComponent(item.slug)}" data-state="${item.state}" data-title="${escapeHtml(item.title.toLowerCase())}">
      <div class="item-title">${escapeHtml(item.title)}</div>
      <div class="item-meta">
        <span class="state-badge" style="background:${stateColor(item.state)}">${item.state.replace(/_/g, ' ')}</span>
        ${badges}
        ${words ? `<span class="word-count">${words} words</span>` : ''}
      </div>
      ${item.draftStats?.excerpt ? `<div class="item-excerpt">${escapeHtml(item.draftStats.excerpt)}</div>` : ''}
    </a>`;
  }
  body += `</ul>`;

  body += `<script>
  const search = document.getElementById('search');
  const items = document.querySelectorAll('.item-card');
  const filters = document.querySelectorAll('.filter-btn');
  let activeState = 'all';

  function applyFilters() {
    const q = search.value.toLowerCase();
    items.forEach(card => {
      const matchState = activeState === 'all' || card.dataset.state === activeState;
      const matchSearch = !q || card.dataset.title.includes(q);
      card.style.display = matchState && matchSearch ? '' : 'none';
    });
  }

  search.addEventListener('input', applyFilters);
  filters.forEach(btn => {
    btn.addEventListener('click', () => {
      filters.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeState = btn.dataset.state;
      applyFilters();
    });
  });
  </script>`;

  return PAGE_SHELL('Content Hub', body, null);
}

function renderItemPage(item) {
  const badges = (item.platforms || []).map(p => `<span class="platform-badge">${platformIcon(p)}</span>`).join('');
  let body = `<div class="detail-header">
    <h1>${escapeHtml(item.title)}</h1>
    <div class="detail-meta">
      <span class="state-badge" style="background:${stateColor(item.state)}">${item.state.replace(/_/g, ' ')}</span>
      <span class="platform-badge">${escapeHtml(item.type)}</span>
      ${badges}
      ${item.draftStats?.words ? `<span class="word-count" style="font-size:.8rem;color:var(--text2)">${item.draftStats.words} words</span>` : ''}
    </div>
    ${item.intent ? `<div class="detail-intent">${escapeHtml(item.intent)}</div>` : ''}
  </div>`;

  const tabs = [{ id: 'draft', label: 'Draft' }, { id: 'notes', label: 'Notes' }];
  for (const ch of (item.channels || [])) {
    tabs.push({ id: `ch-${ch.platform}`, label: platformIcon(ch.platform).toUpperCase(), channel: ch });
  }

  body += `<div class="tab-bar" id="tab-bar">`;
  tabs.forEach((t, i) => {
    body += `<div class="tab${i === 0 ? ' active' : ''}" data-tab="${t.id}">${t.label}</div>`;
  });
  body += `</div>`;

  const draftContent = readFileContent(item.draftPath);
  const notesContent = readFileContent(item.notesPath);

  body += `<div class="tab-panel active" id="panel-draft">
    <div class="content-body">${draftContent ? renderMarkdown(draftContent) : '<div class="empty-state">No draft yet</div>'}</div>
  </div>`;

  body += `<div class="tab-panel" id="panel-notes">
    <div class="content-body">${notesContent ? renderMarkdown(notesContent) : '<div class="empty-state">No notes yet</div>'}</div>
  </div>`;

  for (const ch of (item.channels || [])) {
    const chContent = readFileContent(ch.path);
    body += `<div class="tab-panel" id="panel-ch-${ch.platform}">
      <div class="channel-card">
        <h3>${platformIcon(ch.platform)} Channel
          <span class="state-badge" style="background:${stateColor(ch.state)};font-size:.65rem">${ch.state.replace(/_/g, ' ')}</span>
        </h3>
        <div class="channel-meta">
          ${ch.postedAt ? `<span>Posted: ${ch.postedAt}</span>` : ''}
          ${ch.scheduledFor ? `<span>Scheduled: ${ch.scheduledFor}</span>` : ''}
          ${ch.postUrl ? `<span><a href="${escapeHtml(ch.postUrl)}" style="color:var(--accent)">View post</a></span>` : ''}
        </div>
      </div>
      <div class="content-body">${chContent ? renderMarkdown(chContent) : '<div class="empty-state">Uses base draft</div>'}</div>
    </div>`;
  }

  body += `<script>
  const tabs = document.querySelectorAll('.tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      document.getElementById('panel-' + tab.dataset.tab).classList.add('active');
    });
  });
  </script>`;

  return PAGE_SHELL(item.title, body, '/');
}

function renderIdeasPage() {
  const ideasMd = fs.existsSync(IDEAS_PATH) ? fs.readFileSync(IDEAS_PATH, 'utf8') : '# No ideas file found';
  const body = `<div class="content-body">${renderMarkdown(ideasMd)}</div>`;
  return PAGE_SHELL('Ideas Board', body, '/');
}

function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  try {
    if (pathname === '/' || pathname === '/index.html') {
      const index = readIndex();
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderListPage(index));
      return;
    }

    if (pathname === '/ideas') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderIdeasPage());
      return;
    }

    const itemMatch = pathname.match(/^\/item\/([^/]+)$/);
    if (itemMatch) {
      const slug = decodeURIComponent(itemMatch[1]);
      const index = readIndex();
      const item = index.items.find(i => i.slug === slug);
      if (!item) {
        res.writeHead(404, { 'Content-Type': 'text/html' });
        res.end(PAGE_SHELL('Not Found', '<div class="empty-state">Item not found</div>', '/'));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderItemPage(item));
      return;
    }

    if (pathname === '/api/items') {
      const index = readIndex();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(index));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/html' });
    res.end(PAGE_SHELL('404', '<div class="empty-state">Page not found</div>', '/'));
  } catch (err) {
    console.error(err);
    res.writeHead(500, { 'Content-Type': 'text/html' });
    res.end(PAGE_SHELL('Error', `<div class="empty-state">Server error: ${escapeHtml(err.message)}</div>`, '/'));
  }
}

const server = http.createServer(handleRequest);
server.listen(PORT, HOST, () => {
  console.log(`Content Hub UI running at http://${HOST}:${PORT}`);
  console.log(`Local: http://localhost:${PORT}`);
});
