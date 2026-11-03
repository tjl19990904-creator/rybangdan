// app.js — Leaderboard page logic (Top 100 + multi-payment + my rank)
const $ = (id) => document.getElementById(id);

const state = { config: null, board: [], sse: null, lastBoard: [], myName: localStorage.getItem('myRankName') || '' };

// ---------- Utils ----------
function formatMoney(cents) {
  const major = (cents / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  return `${state.config?.symbol || '$'}${major}`;
}

function medals(rank) {
  return { 1: '🥇', 2: '🥈', 3: '🥉' }[rank] || '';
}

function showToast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.hidden = true; }, 3200);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function providerLabel(id) {
  const p = state.config?.providers?.find(x => x.id === id);
  return p?.label || id;
}

// ---------- Render ----------
function render() {
  const board = state.board;
  const list = $('rankList');
  const podium = $('podium');
  const empty = $('emptyState');

  $('entryCount').textContent = `${board.length} entries`;

  if (board.length === 0) {
    list.innerHTML = '';
    podium.innerHTML = '';
    empty.hidden = false;
    $('myRankPanel').hidden = true;
    return;
  }
  empty.hidden = true;

  // Top 3 podium
  const top3 = board.slice(0, 3);
  podium.innerHTML = top3.map(r => `
    <div class="podium-item podium-${r.rank}">
      <div class="medal">${medals(r.rank)}</div>
      <div class="pname">${escapeHtml(r.name)}</div>
      <div class="pamt">${formatMoney(r.total_cents)}</div>
    </div>
  `).join('');

  // Ranks 4-100
  const rest = board.slice(3, 100);
  const prevKeys = new Set(state.lastBoard.map(r => r.name));
  list.innerHTML = rest.map(r => {
    const isNew = !prevKeys.has(r.name);
    const flashCls = isNew ? 'flash' : '';
    const isMe = state.myName && r.name === state.myName;
    const sub = r.payments > 1 ? `${r.payments} payments · total` : 'First entry';
    const boostBtn = isMe ? ` <button class="btn-boost" onclick="document.getElementById('payBtn').click()">↑ Boost</button>` : '';
    return `
      <li class="rank-item ${flashCls} ${isMe ? 'is-me' : ''}">
        <div class="rank-no">${r.rank}</div>
        <div class="rank-info">
          <div class="rank-name">${escapeHtml(r.name)} ${isMe ? '<span class="me-badge">You</span>' : ''}</div>
          <div class="rank-sub">${sub}</div>
        </div>
        <div class="rank-amount">${formatMoney(r.total_cents)}${boostBtn}</div>
      </li>
    `;
  }).join('');

  state.lastBoard = board.map(r => ({ name: r.name }));
  renderMyRank();
}

async function renderMyRank() {
  const name = state.myName;
  if (!name) { $('myRankPanel').hidden = true; return; }
  try {
    const res = await fetch(`/api/my-rank?name=${encodeURIComponent(name)}`);
    const data = await res.json();
    if (!data.found) {
      $('myRankPanel').hidden = true;
      return;
    }
    $('myRankPanel').hidden = false;
    $('myRankName').textContent = name;
    $('myRankNo').textContent = data.rank;
    $('myRankAmount').textContent = formatMoney(data.me.total_cents);
    $('myRankAround').innerHTML = data.around.map(r => {
      const isMe = r.name === name;
      return `
        <li class="rank-item ${isMe ? 'is-me' : ''}">
          <div class="rank-no">${r.rank}</div>
          <div class="rank-info">
            <div class="rank-name">${escapeHtml(r.name)} ${isMe ? '<span class="me-badge">You</span>' : ''}</div>
          </div>
          <div class="rank-amount">${formatMoney(r.total_cents)}</div>
        </li>
      `;
    }).join('');
  } catch (_) {
    $('myRankPanel').hidden = true;
  }
}

// ---------- Data ----------
async function loadConfig() {
  const res = await fetch('/api/config');
  state.config = await res.json();
  $('siteName').textContent = state.config.siteName;
  document.title = `${state.config.siteName} · Leaderboard`;
  $('curSymbol').textContent = state.config.symbol;
  $('curHint').textContent = `(${state.config.currency.toUpperCase()})`;
  const amt = $('payAmount');
  amt.min = state.config.minAmount;
  amt.placeholder = `Min ${state.config.symbol}${state.config.minAmount}`;

  // Quick amounts
  const quick = $('quickAmounts');
  const presets = [5, 20, 100, 500];
  quick.innerHTML = presets.map(v => `<button type="button" data-v="${v}">${state.config.symbol}${v}</button>`).join('');
  quick.querySelectorAll('button').forEach(b => {
    b.addEventListener('click', () => { $('payAmount').value = b.dataset.v; });
  });

  // Payment method dropdown
  const sel = $('payProvider');
  sel.innerHTML = '<option value="" disabled selected>Select a payment method</option>' +
    (state.config.providers || []).map(p => `<option value="${p.id}">${p.label}</option>`).join('');
  sel.addEventListener('change', updateProviderUI);
}

async function loadLeaderboard() {
  try {
    const res = await fetch('/api/leaderboard');
    const data = await res.json();
    state.board = data.board || [];
    render();
  } catch (e) {
    console.error('Failed to load leaderboard', e);
  }
}

// ---------- SSE ----------
function connectSSE() {
  try {
    const es = new EventSource('/api/stream');
    state.sse = es;
    es.addEventListener('leaderboard', (e) => {
      try { state.board = JSON.parse(e.data); render(); } catch (_) {}
    });
    es.addEventListener('open', () => { $('liveDot').style.opacity = '1'; });
    es.addEventListener('error', () => { $('liveDot').style.opacity = '.4'; });
  } catch (e) {
    setInterval(loadLeaderboard, 5000);
  }
}

// ---------- Find my rank ----------
function bindFindRank() {
  $('findBtn').addEventListener('click', () => {
    const name = $('findName').value.trim();
    if (!name) return;
    state.myName = name;
    localStorage.setItem('myRankName', name);
    renderMyRank();
    $('clearFindBtn').hidden = false;
  });
  $('findName').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('findBtn').click(); });
  $('clearFindBtn').addEventListener('click', () => {
    state.myName = '';
    localStorage.removeItem('myRankName');
    $('findName').value = '';
    $('clearFindBtn').hidden = true;
    $('myRankPanel').hidden = true;
  });
  if (state.myName) {
    $('findName').value = state.myName;
    $('clearFindBtn').hidden = false;
  }
}

// ---------- Payment modal ----------
function updateProviderUI() {
  const id = $('payProvider').value;
  const p = state.config?.providers?.find(x => x.id === id);
  const box = $('manualBox');
  const note = $('payNote');
  const refInput = $('manualRef');
  const refLabel = $('refLabel');
  if (!p) { box.hidden = true; note.textContent = ''; return; }

  if (p.mode === 'manual' || p.mode === 'crypto' || p.mode === 'bank') {
    box.hidden = false;
    if (p.mode === 'crypto') { refLabel.textContent = 'Transaction Hash (TxHash)'; refInput.placeholder = 'e.g. 0xabc...'; }
    else if (id === 'alipay' || id === 'wechat') { refLabel.textContent = 'Transaction ID / Last 4 digits'; refInput.placeholder = 'e.g. 2024...'; }
    else { refLabel.textContent = 'Transaction Reference'; refInput.placeholder = 'Fill in after payment'; }
    note.textContent = 'Complete payment per instructions and submit the reference. You will be ranked after admin confirmation.';
  } else {
    box.hidden = true;
    note.textContent = 'You will be redirected to a secure payment page.';
  }
}

function bindModal() {
  const modal = $('payModal');
  $('payBtn').addEventListener('click', () => {
    modal.hidden = false;
    $('payName').focus();
    updateProviderUI();
  });
  modal.querySelectorAll('[data-close]').forEach(el => {
    el.addEventListener('click', () => { modal.hidden = true; });
  });

  $('payForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('payName').value.trim();
    const amount = Number($('payAmount').value);
    const provider = $('payProvider').value;
    const noteEl = $('payNote');
    if (!name) return;
    if (!provider) { noteEl.textContent = 'Please select a payment method'; return; }
    if (!amount || amount < (state.config.minAmount || 1)) {
      noteEl.textContent = `Minimum amount is ${state.config.symbol}${state.config.minAmount}`;
      return;
    }

    const btn = $('paySubmit');
    btn.disabled = true;
    btn.textContent = 'Processing...';
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, amount, provider }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Request failed');

      if (data.mode === 'redirect' && data.url) {
        state.myName = name; localStorage.setItem('myRankName', name);
        window.location.href = data.url;
        return;
      }

      if (data.mode === 'manual') {
        $('manualInstructions').innerHTML = formatInstructions(data.instructions);
        btn.textContent = 'Submit Reference';
        btn.disabled = false;
        btn._manualPaymentId = data.payment?.id;
        return;
      }

      // Demo: direct ranking
      modal.hidden = true;
      resetPayForm();
      state.myName = name; localStorage.setItem('myRankName', name);
      // 排名变化提示
      let rankMsg = `🎉 ${name} is on the board!`;
      if (data.beforeRank && data.afterRank) {
        const change = data.beforeRank.rank - data.afterRank.rank;
        if (change > 0) {
          rankMsg = `🎉 ${name} moved up ${change} spot${change > 1 ? 's' : ''}! Now ranked #${data.afterRank.rank}`;
        } else if (change === 0) {
          rankMsg = `🎉 ${name} boosted the total! Still ranked #${data.afterRank.rank}`;
        } else {
          rankMsg = `🎉 ${name} is on the board at #${data.afterRank.rank}`;
        }
      }
      showToast(rankMsg);
      loadLeaderboard();
    } catch (err) {
      noteEl.textContent = '⚠️ ' + err.message;
      btn.textContent = 'Confirm Payment';
      btn.disabled = false;
    }
  });

  // Manual reference submission
  $('paySubmit').addEventListener('click', async (e) => {
    const pid = $('paySubmit')._manualPaymentId;
    if (!pid) return;
    e.preventDefault();
    const ref = $('manualRef').value.trim();
    const note = $('manualNote').value.trim();
    if (!ref) { $('payNote').textContent = 'Please enter the transaction reference'; return; }
    const btn = $('paySubmit');
    btn.disabled = true; btn.textContent = 'Submitting...';
    try {
      const res = await fetch(`/api/checkout/${pid}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ref, note }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Submission failed');
      $('payModal').hidden = true;
      resetPayForm();
      showToast('Reference submitted. You will be ranked after admin confirmation.');
    } catch (err) {
      $('payNote').textContent = '⚠️ ' + err.message;
      btn.disabled = false; btn.textContent = 'Submit Reference';
    }
  });
}

function formatInstructions(ins) {
  if (!ins) return '';
  let html = '';
  if (ins.amount) html += `<div><b>Amount:</b> ${ins.amount} ${ins.currency || ''}</div>`;
  if (ins.network) html += `<div><b>Network:</b> ${escapeHtml(ins.network)}</div>`;
  if (ins.address) html += `<div class="copy-row"><b>Address:</b> <code>${escapeHtml(ins.address)}</code><button type="button" class="btn-copy" data-copy="${escapeHtml(ins.address)}">Copy</button></div>`;
  if (ins.account) html += `<div class="copy-row"><b>Account:</b> <code>${escapeHtml(ins.account)}</code><button type="button" class="btn-copy" data-copy="${escapeHtml(ins.account)}">Copy</button></div>`;
  if (ins.holder) html += `<div><b>Holder:</b> ${escapeHtml(ins.holder)}</div>`;
  if (ins.bankName) html += `<div><b>Bank:</b> ${escapeHtml(ins.bankName)}</div>`;
  if (ins.cashtag) html += `<div class="copy-row"><b>Cashtag:</b> <code>${escapeHtml(ins.cashtag)}</code></div>`;
  if (ins.payeeEmail) html += `<div><b>Payee Email:</b> ${escapeHtml(ins.payeeEmail)}</div>`;
  if (ins.qrUrl) html += `<div><a href="${escapeHtml(ins.qrUrl)}" target="_blank" rel="noopener">Open QR code</a></div>`;
  if (ins.reference) html += `<div class="copy-row"><b>Reference:</b> <code>${escapeHtml(ins.reference)}</code><button type="button" class="btn-copy" data-copy="${escapeHtml(ins.reference)}">Copy</button></div>`;
  if (ins.note) html += `<div class="ins-note">${escapeHtml(ins.note).replace(/\n/g, '<br>')}</div>`;
  return html;
}

function resetPayForm() {
  $('payName').value = '';
  $('payAmount').value = '';
  $('payProvider').value = '';
  $('manualBox').hidden = true;
  $('manualRef').value = '';
  $('manualNote').value = '';
  $('manualInstructions').innerHTML = '';
  $('paySubmit').textContent = 'Confirm Payment';
  $('paySubmit')._manualPaymentId = null;
  $('payNote').textContent = '';
}

// Copy button delegation
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.btn-copy');
  if (!btn) return;
  navigator.clipboard.writeText(btn.dataset.copy).then(() => showToast('Copied'));
});

// ---------- Boot ----------
(async () => {
  await loadConfig();
  await loadLeaderboard();
  bindModal();
  bindFindRank();
  connectSSE();
})();
