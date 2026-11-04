'use strict';

const BIRDS = ['🐦', '🦜', '🦉', '🦆', '🐧', '🦢', '🦩', '🐤', '🦅', '🕊️', '🐓', '🦚'];
const $ = (id) => document.getElementById(id);
let me = null;

// ---- tiny API helper ------------------------------------------------------
async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: opts.body && !(opts.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {},
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'something went wrong');
  return data;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function timeAgo(iso) {
  const d = (Date.now() - new Date(iso.replace(' ', 'T') + 'Z').getTime()) / 1000;
  if (d < 60) return 'just now';
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}
function toast(msg, note) {
  const t = $('toast');
  t.innerHTML = esc(msg) + (note ? `<span class="ns">${esc(note)}</span>` : '');
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 3200);
}

// ===========================================================================
//  AUTH SCREEN
// ===========================================================================
function renderAuth() {
  let mode = 'login';
  let bird = '🐦';
  const app = $('app');
  function paint() {
    app.innerHTML = `
      <div class="auth-wrap">
        <div class="auth-card">
          <div class="brand"><span class="mark">🐦</span>Bird <em>Buddies</em></div>
          <p class="auth-tag">share little moments with your flock</p>
          <div class="err" id="autherr"></div>
          ${mode === 'signup' ? `
            <div class="field"><label>pick your bird</label>
              <div class="bird-pick" id="birds">${BIRDS.map((b) => `<button type="button" data-b="${b}" class="${b === bird ? 'sel' : ''}">${b}</button>`).join('')}</div>
            </div>
            <div class="field"><label>display name</label><input id="display" placeholder="Robin Featherstone" maxlength="40" /></div>
          ` : ''}
          <div class="field"><label>username</label><input id="username" placeholder="robin" autocomplete="username" /></div>
          <div class="field"><label>password</label><input id="password" type="password" placeholder="••••••••" autocomplete="${mode === 'signup' ? 'new-password' : 'current-password'}" /></div>
          <button class="btn" id="go" style="width:100%; justify-content:center; margin-top:0.4rem;">${mode === 'signup' ? 'Join the flock' : 'Fly in'}</button>
          <p class="auth-switch">
            ${mode === 'signup' ? 'already have a nest?' : 'new here?'}
            <button class="linklike" id="swap">${mode === 'signup' ? 'log in' : 'make an account'}</button>
          </p>
        </div>
      </div>`;

    if (mode === 'signup') {
      $('birds').onclick = (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        bird = b.dataset.b;
        [...$('birds').children].forEach((c) => c.classList.toggle('sel', c.dataset.b === bird));
      };
    }
    $('swap').onclick = () => { mode = mode === 'login' ? 'signup' : 'login'; paint(); };
    $('go').onclick = submit;
    [$('username'), $('password')].forEach((el) => (el.onkeydown = (e) => { if (e.key === 'Enter') submit(); }));
  }
  async function submit() {
    const body = { username: $('username').value, password: $('password').value };
    if (mode === 'signup') { body.display = $('display').value; body.bird = bird; }
    try {
      const { user } = await api(`/api/${mode === 'signup' ? 'signup' : 'login'}`, { method: 'POST', body: JSON.stringify(body) });
      me = user;
      renderApp();
    } catch (e) {
      $('autherr').textContent = e.message;
    }
  }
  paint();
}

// ===========================================================================
//  MAIN APP
// ===========================================================================
async function renderApp() {
  $('app').innerHTML = `
    <header class="topbar">
      <div class="brand"><span class="mark">🐦</span>Bird <em>Buddies</em></div>
      <div class="spacer"></div>
      <div class="me-chip"><span class="av">${me.bird}</span>${esc(me.display)}</div>
      <button class="btn ghost small" id="logout">log out</button>
    </header>
    <div class="shell">
      <main>
        <div id="composer"></div>
        <h2 class="section-title">Your flock's feed <small>photos from you &amp; your buddies</small></h2>
        <div class="feed" id="feed"></div>
      </main>
      <aside class="rail">
        <div class="panel" id="requests"></div>
        <div class="panel" id="find"></div>
        <div class="panel" id="friends"></div>
      </aside>
    </div>`;
  $('logout').onclick = async () => { await api('/api/logout', { method: 'POST' }); me = null; renderAuth(); };
  renderComposer();
  loadReportReasons();
  loadFeed();
  loadFriends();
  renderFind();
}

// ---- composer -------------------------------------------------------------
function renderComposer() {
  let file = null;
  const el = $('composer');
  el.className = 'composer';
  el.innerHTML = `
    <h2>Share a moment 📸</h2>
    <label class="drop" id="drop">
      <span id="droptext">Click to choose a photo</span>
      <input type="file" accept="image/*" id="fileinput" hidden />
      <div id="preview"></div>
    </label>
    <textarea id="caption" placeholder="say something about it…" maxlength="500"></textarea>
    <div class="row">
      <button class="btn teal" id="post" disabled>Post to feed</button>
    </div>`;
  const input = $('fileinput');
  $('drop').onclick = (e) => { if (e.target.tagName !== 'INPUT') input.click(); };
  input.onchange = () => {
    file = input.files[0];
    if (!file) return;
    $('droptext').textContent = file.name;
    const r = new FileReader();
    r.onload = () => ($('preview').innerHTML = `<img src="${r.result}" alt="preview" />`);
    r.readAsDataURL(file);
    $('post').disabled = false;
  };
  $('post').onclick = async () => {
    if (!file) return;
    const fd = new FormData();
    fd.append('photo', file);
    fd.append('caption', $('caption').value);
    $('post').disabled = true;
    try {
      await api('/api/photos', { method: 'POST', body: fd });
      toast('Posted to your feed! 🪺');
      renderComposer();
      loadFeed();
    } catch (e) { toast(e.message); $('post').disabled = false; }
  };
}

// ---- feed -----------------------------------------------------------------
async function loadFeed() {
  const { photos } = await api('/api/feed');
  const feed = $('feed');
  if (!photos.length) {
    feed.innerHTML = `<div class="empty"><div class="big">🪹</div><p><b>Your nest is empty.</b><br/>Post a photo or add some buddies to fill your feed.</p></div>`;
    return;
  }
  feed.innerHTML = photos.map((p) => `
    <article class="polaroid">
      ${p.status === 'flagged' ? '<div class="flagged-badge" title="Flagged by moderation">⚠ under review</div>' : ''}
      <img class="pic" src="/uploads/${esc(p.filename)}" alt="${esc(p.caption)}" data-id="${p.id}" loading="lazy" />
      ${p.caption ? `<div class="cap">${esc(p.caption)}</div>` : ''}
      <div class="meta">
        <span class="who"><span class="av">${p.bird}</span>${esc(p.display)}</span>
        <span>${timeAgo(p.created_at)} · <span class="cmt-count">💬 ${p.comment_count}</span></span>
      </div>
    </article>`).join('');
  feed.querySelectorAll('.pic').forEach((img) => (img.onclick = () => openPhoto(img.dataset.id)));
}

// ---- photo modal ----------------------------------------------------------
async function openPhoto(id) {
  const { photo, comments } = await api(`/api/photos/${id}`);
  const root = $('modal-root');
  const render = (comments) => {
    root.innerHTML = `
      <div class="modal-bg" id="mbg">
        <div class="modal" style="position:relative">
          <button class="close" id="mclose">✕</button>
          <div class="stage"><img src="/uploads/${esc(photo.filename)}" alt="${esc(photo.caption)}" /></div>
          <div class="side">
            <div class="hd">
              <span class="av">${photo.bird}</span>
              <div style="flex:1"><b>${esc(photo.display)}</b><br/><span class="muted">${timeAgo(photo.created_at)}</span></div>
              <button class="report-btn" id="report" title="Report this photo"><span class="flag">⚑</span> Report</button>
            </div>
            ${photo.caption ? `<div class="cap-full">${esc(photo.caption)}</div>` : ''}
            <div class="comments" id="comments">
              ${comments.length ? comments.map((c) => `
                <div class="comment">
                  <span class="av">${c.bird}</span>
                  <div class="bubble"><b>${esc(c.display)}</b> <span class="muted">· ${timeAgo(c.created_at)}</span><p>${esc(c.body)}</p></div>
                </div>`).join('') : `<p class="muted" style="padding:0.6rem 0">No comments yet — be the first!</p>`}
            </div>
            <div class="cbox">
              <input id="cinput" placeholder="add a comment…" maxlength="1000" />
              <button class="btn small" id="csend">Send</button>
            </div>
          </div>
        </div>
      </div>`;
    $('mbg').onclick = (e) => { if (e.target.id === 'mbg') close(); };
    $('mclose').onclick = close;
    $('report').onclick = () => reportThing('photo', photo.id);
    const send = async () => {
      const body = $('cinput').value.trim();
      if (!body) return;
      try {
        await api(`/api/photos/${id}/comments`, { method: 'POST', body: JSON.stringify({ body }) });
        const fresh = await api(`/api/photos/${id}`);
        render(fresh.comments);
        loadFeed();
      } catch (e) { toast(e.message); }
    };
    $('csend').onclick = send;
    $('cinput').onkeydown = (e) => { if (e.key === 'Enter') send(); };
    $('cinput').focus();
  };
  const close = () => (root.innerHTML = '');
  render(comments);
}

// ---- reporting -------------------------------------------------------------
let REPORT_REASONS = [];
async function loadReportReasons() {
  try {
    REPORT_REASONS = (await api('/api/report-reasons')).reasons || [];
  } catch {
    REPORT_REASONS = [];
  }
}

// Open a menu of reasons for reporting a photo/comment.
function reportThing(targetType, targetId) {
  const host = document.createElement('div');
  host.className = 'modal-bg report-bg';
  host.innerHTML = `
    <div class="report-card">
      <h3>Report this ${esc(targetType)}</h3>
      <p class="muted">Why are you reporting it?</p>
      <div class="reason-list">
        ${REPORT_REASONS.map((r) => `<button class="reason" data-id="${esc(r.id)}">${esc(r.label)}</button>`).join('')}
      </div>
      <button class="linklike report-cancel">Cancel</button>
    </div>`;
  document.body.appendChild(host);
  const close = () => host.remove();
  host.onclick = (e) => { if (e.target === host) close(); };
  host.querySelector('.report-cancel').onclick = close;
  host.querySelectorAll('.reason').forEach((b) => {
    b.onclick = async () => {
      close();
      try {
        const r = await api('/api/report', {
          method: 'POST',
          body: JSON.stringify({ targetType, targetId, reasonId: b.dataset.id }),
        });
        toast('Thanks, we got your report.', r.queued ? 'Sent for review.' : 'Reporting is not set up yet.');
      } catch (e) { toast(e.message); }
    };
  });
}

// ---- find people ----------------------------------------------------------
function renderFind() {
  const el = $('find');
  el.innerHTML = `
    <h3>Find buddies 🔎</h3>
    <div class="search"><input id="q" placeholder="search by name…" /><button class="btn small" id="qbtn">Go</button></div>
    <div class="ulist" id="results"><p class="muted">Search for people to add.</p></div>`;
  const run = async () => {
    const q = $('q').value.trim();
    const { users } = await api('/api/users?q=' + encodeURIComponent(q));
    const res = $('results');
    if (!users.length) { res.innerHTML = `<p class="muted">No birds found.</p>`; return; }
    res.innerHTML = users.map(userRow).join('');
    wireUserRows(res);
  };
  $('qbtn').onclick = run;
  $('q').onkeydown = (e) => { if (e.key === 'Enter') run(); };
  renderFind.lastQuery = run; // so friend actions can refresh current results
}

function userRow(u) {
  const action = {
    none: `<button class="btn small" data-act="request" data-id="${u.id}">+ add</button>`,
    requested: `<span class="tag">requested</span>`,
    incoming: `<button class="btn small teal" data-act="accept" data-id="${u.id}">accept</button>`,
    friend: `<span class="tag friend">buddies</span>`,
  }[u.relation || 'none'];
  return `<div class="urow"><span class="av">${u.bird}</span><div class="n"><b>${esc(u.display)}</b><span>@${esc(u.username)}</span></div>${action}</div>`;
}

function wireUserRows(container) {
  container.querySelectorAll('button[data-act]').forEach((b) => {
    b.onclick = async () => {
      const act = b.dataset.act, id = b.dataset.id;
      try {
        await api(`/api/friends/${act === 'accept' ? 'accept' : 'request'}`, { method: 'POST', body: JSON.stringify({ userId: Number(id) }) });
        toast(act === 'accept' ? 'You are now buddies! 🎉' : 'Request sent 🕊️');
        renderFind.lastQuery && renderFind.lastQuery();
        loadFriends();
        loadFeed();
      } catch (e) { toast(e.message); }
    };
  });
}

// ---- friends + requests ---------------------------------------------------
async function loadFriends() {
  const { friends, incoming } = await api('/api/friends');
  const req = $('requests');
  if (incoming.length) {
    req.classList.remove('hidden');
    req.innerHTML = `<h3>Buddy requests 🔔</h3><div class="ulist">${incoming.map((u) => `
      <div class="urow"><span class="av">${u.bird}</span><div class="n"><b>${esc(u.display)}</b><span>@${esc(u.username)}</span></div>
      <button class="btn small teal" data-act="accept" data-id="${u.id}">accept</button></div>`).join('')}</div>`;
    wireUserRows(req);
  } else {
    req.classList.add('hidden');
  }

  const f = $('friends');
  f.innerHTML = `<h3>Your flock 🪶 <span class="muted">(${friends.length})</span></h3>
    <div class="ulist">${friends.length ? friends.map((u) => `
      <div class="urow"><span class="av">${u.bird}</span><div class="n"><b>${esc(u.display)}</b><span>@${esc(u.username)}</span></div><span class="tag friend">buddies</span></div>`).join('')
      : `<p class="muted">No buddies yet. Find some above!</p>`}</div>`;
}

// ===========================================================================
//  BOOT
// ===========================================================================
(async function boot() {
  try {
    const { user } = await api('/api/me');
    if (user) { me = user; renderApp(); } else { renderAuth(); }
  } catch { renderAuth(); }
})();
