// app.js — Leaderboard page logic (Top 100 + multi-payment + my rank + i18n)
// i18n.js 在 <head> 同步加载，提供 t / getLang / setLang / applyI18n
const $ = (id) => document.getElementById(id);
const t = window.t;
const getLang = window.getLang;

const state = { config: null, board: [], sse: null, lastBoard: [], myName: localStorage.getItem('myRankName') || '' };

// ---------- Utils ----------
function sym() { return state.config?.symbol || '$'; }

function formatMoney(cents) {
  const locale = getLang() === 'zh' ? 'zh-CN' : 'en-US';
  const major = (cents / 100).toLocaleString(locale, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  return `${sym()}${major}`;
}

function medals(rank) { return { 1: '🥇', 2: '🥈', 3: '🥉' }[rank] || ''; }

function showToast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(el._timer);
  el._timer = setTimeout(() => { el.hidden = true; }, 3200);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// 服务端错误文案在中文站为原生中文；英文模式下把常见条目本地化，其余原样透传
function localizeError(msg) {
  const text = String(msg || '');
  if (getLang() !== 'en') return text;
  if (/^该支付方式最低金额为/.test(text)) return t('modal.needAmount', { sym: sym(), n: currentMinAmount() });
  if (/^最低上榜金额为/.test(text)) return t('modal.needAmount', { sym: sym(), n: state.config?.minAmount || 1 });
  const rate = text.match(/^操作过于频繁，相同金额请在\s*(\d+)\s*分钟后重试/);
  if (rate) return `Too many attempts. Please retry the same amount in ${rate[1]} minutes.`;
  const map = {
    '请填写姓名': 'Please enter your name',
    '金额无效': 'Invalid amount',
    '支付方式不存在': 'Payment method not found',
    '支付记录不存在': 'Payment record not found',
  };
  if (map[text]) return map[text];
  const fail = text.match(/^支付创建失败[:：]\s*(.*)$/);
  if (fail) return `Payment creation failed: ${fail[1]}`;
  return text;
}

// ---------- Render ----------
function render() {
  const board = state.board;
  const list = $('rankList');
  const podium = $('podium');
  const empty = $('emptyState');

  $('entryCount').textContent = t('lb.entries', { n: board.length });

  if (board.length === 0) {
    list.innerHTML = '';
    podium.innerHTML = '';
    empty.hidden = false;
    $('myRankPanel').hidden = true;
    return;
  }
  empty.hidden = true;

  podium.innerHTML = board.slice(0, 3).map(r => `
    <div class="podium-item podium-${r.rank}">
      <div class="medal">${medals(r.rank)}</div>
      <div class="pname">${escapeHtml(r.name)}</div>
      <div class="pamt">${formatMoney(r.total_cents)}</div>
    </div>
  `).join('');

  const rest = board.slice(3, 100);
  const prevKeys = new Set(state.lastBoard.map(r => r.name));
  list.innerHTML = rest.map(r => {
    const isNew = !prevKeys.has(r.name);
    const flashCls = isNew ? 'flash' : '';
    const isMe = state.myName && r.name === state.myName;
    const sub = r.payments > 1 ? t('rank.payments', { n: r.payments }) : t('rank.first');
    const boostBtn = isMe ? ` <button class="btn-boost" onclick="document.getElementById('payBtn').click()">${t('rank.boost')}</button>` : '';
    return `
      <li class="rank-item ${flashCls} ${isMe ? 'is-me' : ''}">
        <div class="rank-no">${r.rank}</div>
        <div class="rank-info">
          <div class="rank-name">${escapeHtml(r.name)} ${isMe ? `<span class="me-badge">${t('rank.you')}</span>` : ''}</div>
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
    if (!data.found) { $('myRankPanel').hidden = true; return; }
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
            <div class="rank-name">${escapeHtml(r.name)} ${isMe ? `<span class="me-badge">${t('rank.you')}</span>` : ''}</div>
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
  document.title = t('doc.title', { site: state.config.siteName });
  $('curSymbol').textContent = state.config.symbol;
  $('curHint').textContent = `(${state.config.currency.toUpperCase()})`;
  const amt = $('payAmount');
  amt.min = state.config.minAmount;
  amt.placeholder = t('modal.minAmount', { sym: sym(), n: state.config.minAmount });

  const quick = $('quickAmounts');
  const presets = [5, 20, 100, 500];
  quick.innerHTML = presets.map(v => `<button type="button" data-v="${v}">${sym()}${v}</button>`).join('');
  quick.querySelectorAll('button').forEach(b => {
    b.addEventListener('click', () => { $('payAmount').value = b.dataset.v; });
  });

  const sel = $('payProvider');
  sel.innerHTML = `<option value="" disabled selected>${t('modal.selectMethod')}</option>` +
    (state.config.providers || []).map(p => `<option value="${p.id}">${escapeHtml(p.label)}</option>`).join('');
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
// 当前所选支付方式的最低金额（未单独配置时回退到全站下限）
function currentMinAmount() {
  const id = $('payProvider')?.value;
  const p = state.config?.providers?.find(x => x.id === id);
  return Number(p?.minAmount) || Number(state.config?.minAmount) || 1;
}

function updateProviderUI() {
  const id = $('payProvider').value;
  const p = state.config?.providers?.find(x => x.id === id);
  const box = $('manualBox');
  const note = $('payNote');
  const refInput = $('manualRef');
  const refLabel = $('refLabel');
  const globalMin = Number(state.config?.minAmount) || 1;

  if (!p) {
    box.hidden = true;
    note.textContent = '';
    $('payAmount').min = globalMin;
    $('payAmount').placeholder = t('modal.minAmount', { sym: sym(), n: globalMin });
    return;
  }

  if (p.mode === 'manual' || p.mode === 'crypto' || p.mode === 'bank') {
    box.hidden = false;
    if (p.mode === 'crypto') {
      refLabel.textContent = t('modal.refLabelCrypto');
      refInput.placeholder = t('modal.refPhCrypto');
    } else if (id === 'alipay' || id === 'wechat') {
      refLabel.textContent = t('modal.refLabelCN');
      refInput.placeholder = t('modal.refPhCN');
    } else {
      refLabel.textContent = t('modal.refLabelDefault');
      refInput.placeholder = t('modal.refPh');
    }
    note.textContent = t('modal.manualHint');
  } else {
    box.hidden = true;
    note.textContent = t('modal.redirectHint');
  }

  // 按支付方式动态调整金额下限，避免提交后才被平台拒绝
  const min = Number(p.minAmount) || globalMin;
  $('payAmount').min = min;
  $('payAmount').placeholder = t('modal.minAmount', { sym: sym(), n: min });
  if (min > globalMin) note.textContent += t('modal.minForMethod', { sym: sym(), n: min });
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
    if (!provider) { noteEl.textContent = t('modal.needMethod'); return; }
    const minAmount = currentMinAmount();
    if (!amount || amount < minAmount) {
      noteEl.textContent = t('modal.needAmount', { sym: sym(), n: minAmount });
      return;
    }

    const btn = $('paySubmit');
    btn.disabled = true;
    btn.textContent = t('modal.processing');
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
        btn.textContent = t('modal.submitRef');
        btn.disabled = false;
        btn._manualPaymentId = data.payment?.id;
        return;
      }

      // Demo: direct ranking
      modal.hidden = true;
      resetPayForm();
      state.myName = name; localStorage.setItem('myRankName', name);
      let rankMsg = t('toast.onBoard', { name });
      if (data.beforeRank && data.afterRank) {
        const change = data.beforeRank.rank - data.afterRank.rank;
        if (change > 0) {
          rankMsg = t(change === 1 ? 'toast.movedUp1' : 'toast.movedUp', { name, n: change, rank: data.afterRank.rank });
        } else if (change === 0) {
          rankMsg = t('toast.boosted', { name, rank: data.afterRank.rank });
        } else {
          rankMsg = t('toast.atRank', { name, rank: data.afterRank.rank });
        }
      }
      showToast(rankMsg);
      loadLeaderboard();
    } catch (err) {
      noteEl.textContent = '⚠️ ' + localizeError(err.message);
      btn.textContent = t('modal.submit');
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
    if (!ref) { $('payNote').textContent = t('modal.needRef'); return; }
    const btn = $('paySubmit');
    btn.disabled = true; btn.textContent = t('modal.submitting');
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
      showToast(t('toast.refSubmitted'));
    } catch (err) {
      $('payNote').textContent = '⚠️ ' + localizeError(err.message);
      btn.disabled = false; btn.textContent = t('modal.submitRef');
    }
  });
}

function formatInstructions(ins) {
  if (!ins) return '';
  let html = '';
  if (ins.amount) html += `<div><b>${t('ins.amount')}:</b> ${ins.amount} ${ins.currency || ''}</div>`;
  if (ins.network) html += `<div><b>${t('ins.network')}:</b> ${escapeHtml(ins.network)}</div>`;
  if (ins.address) html += `<div class="copy-row"><b>${t('ins.address')}:</b> <code>${escapeHtml(ins.address)}</code><button type="button" class="btn-copy" data-copy="${escapeHtml(ins.address)}">${t('ins.copy')}</button></div>`;
  if (ins.account) html += `<div class="copy-row"><b>${t('ins.account')}:</b> <code>${escapeHtml(ins.account)}</code><button type="button" class="btn-copy" data-copy="${escapeHtml(ins.account)}">${t('ins.copy')}</button></div>`;
  if (ins.holder) html += `<div><b>${t('ins.holder')}:</b> ${escapeHtml(ins.holder)}</div>`;
  if (ins.bankName) html += `<div><b>${t('ins.bank')}:</b> ${escapeHtml(ins.bankName)}</div>`;
  if (ins.cashtag) html += `<div class="copy-row"><b>${t('ins.cashtag')}:</b> <code>${escapeHtml(ins.cashtag)}</code></div>`;
  if (ins.payeeEmail) html += `<div><b>${t('ins.payeeEmail')}:</b> ${escapeHtml(ins.payeeEmail)}</div>`;
  if (ins.qrUrl) html += `<div><a href="${escapeHtml(ins.qrUrl)}" target="_blank" rel="noopener">${t('ins.qr')}</a></div>`;
  if (ins.reference) html += `<div class="copy-row"><b>${t('ins.reference')}:</b> <code>${escapeHtml(ins.reference)}</code><button type="button" class="btn-copy" data-copy="${escapeHtml(ins.reference)}">${t('ins.copy')}</button></div>`;
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
  $('paySubmit').textContent = t('modal.submit');
  $('paySubmit')._manualPaymentId = null;
  $('payNote').textContent = '';
}

// Copy button delegation
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.btn-copy');
  if (!btn) return;
  navigator.clipboard.writeText(btn.dataset.copy).then(() => showToast(t('toast.copied')));
});

// ---------- Language change: re-render every dynamic block ----------
window.addEventListener('langchange', () => {
  if (state.config) document.title = t('doc.title', { site: state.config.siteName });
  render();
  renderMyRank();
  if (state.config) {
    const first = $('payProvider').querySelector('option[value=""]');
    if (first) first.textContent = t('modal.selectMethod');
    $('payAmount').placeholder = t('modal.minAmount', { sym: sym(), n: currentMinAmount() });
  }
  updateProviderUI();
  const submit = $('paySubmit');
  if (submit && !submit.disabled) submit.textContent = submit._manualPaymentId ? t('modal.submitRef') : t('modal.submit');
});

// ---------- Boot ----------
(async () => {
  await loadConfig();
  await loadLeaderboard();
  bindModal();
  bindFindRank();
  connectSSE();
})();
