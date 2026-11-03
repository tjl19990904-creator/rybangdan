// admin.js — 后台管理逻辑（多 Provider + 手动确认）
const $ = (id) => document.getElementById(id);
const state = { config: null, sse: null };

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmtMoney(cents, sym) {
  if (cents == null) return '—';
  const major = (cents / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  return `${sym}${major}`;
}
function fmtTime(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString(); } catch (_) { return iso; }
}
function shortId(s) {
  if (!s) return '—';
  const t = escapeHtml(s);
  return `<span class="mono">${t.length > 20 ? t.slice(0, 10) + '…' + t.slice(-8) : t}</span>`;
}
function providerLabel(id) {
  const p = state.config?.providers?.find(x => x.id === id);
  return p?.label || id;
}
function showToast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.hidden = true; }, 2500);
}

// ---------- 鉴权 ----------
async function checkAuth() {
  try { const res = await fetch('/api/admin/me'); return res.ok; }
  catch (_) { return false; }
}

$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const pwd = $('loginPwd').value;
  $('loginError').textContent = '';
  const res = await fetch('/api/admin/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: pwd }),
  });
  if (res.ok) enterAdmin();
  else {
    const data = await res.json().catch(() => ({}));
    $('loginError').textContent = data.error || '登录失败';
  }
});

$('logoutBtn').addEventListener('click', async () => {
  await fetch('/api/admin/logout', { method: 'POST' });
  $('adminView').hidden = true; $('loginView').hidden = false; $('loginPwd').value = '';
});

async function enterAdmin() {
  $('loginView').hidden = true; $('adminView').hidden = false;
  await loadConfig();
  await Promise.all([loadStats(), loadPayments(), loadProviders(), loadLeaderboard(), loadWithdrawals()]);
  connectSSE();
}

// ---------- 加载配置 ----------
async function loadConfig() {
  const res = await fetch('/api/config');
  state.config = await res.json();
  // 填充 provider 筛选
  const sel = $('filterProvider');
  sel.innerHTML = '<option value="all">全部方式</option>' +
    (state.config.providers || []).map(p => `<option value="${p.id}">${p.label}</option>`).join('');
  sel.addEventListener('change', loadPayments);
}

// ---------- 统计 ----------
async function loadStats() {
  const res = await fetch('/api/admin/stats');
  const s = await res.json();
  const sym = state.config?.symbol || '$';
  const cards = [
    { label: '累计收款', value: fmtMoney(s.totalReceivedCents, sym), cls: 'ok' },
    { label: '已提款', value: fmtMoney(s.totalWithdrawnCents, sym), cls: 'warn' },
    { label: '净余额', value: fmtMoney(s.netCents, sym), cls: 'info' },
    { label: '待结算', value: fmtMoney(s.totalPendingCents, sym), cls: 'warn' },
    { label: '已支付笔数', value: s.paidCount, cls: '' },
    { label: '榜首用户', value: s.topPayer ? escapeHtml(s.topPayer.name) : '—', cls: '' },
  ];
  $('statsGrid').innerHTML = cards.map(c => `
    <div class="stat-card"><div class="label">${c.label}</div><div class="value ${c.cls}">${c.value}</div></div>
  `).join('');
}

// ---------- 支付记录 ----------
async function loadPayments() {
  const status = $('filterStatus').value;
  const provider = $('filterProvider').value;
  const search = $('searchInput').value;
  const res = await fetch(`/api/admin/payments?status=${encodeURIComponent(status)}&provider=${encodeURIComponent(provider)}&search=${encodeURIComponent(search)}`);
  const data = await res.json();
  const sym = state.config?.symbol || '$';
  const body = $('paymentsBody');
  if (!data.payments.length) {
    body.innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--muted);padding:30px;">暂无记录</td></tr>`;
    return;
  }
  body.innerHTML = data.payments.map(p => {
    const canConfirm = p.status === 'pending';
    return `
    <tr>
      <td>${p.id}</td>
      <td>${escapeHtml(p.name)}</td>
      <td>${fmtMoney(p.amount_cents, sym)}</td>
      <td><span class="provider-badge">${providerLabel(p.provider)}</span></td>
      <td><span class="status-badge status-${p.status}">${p.status}</span></td>
      <td>${fmtTime(p.paid_at || p.created_at)}</td>
      <td>${shortId(p.provider_ref || p.stripe_session_id)}</td>
      <td>
        <div class="row-actions">
          <button class="btn btn-ghost btn-sm" onclick="editPayment(${p.id})">编辑</button>
          ${canConfirm ? `<button class="btn btn-primary btn-sm" onclick="confirmPayment(${p.id})">确认支付</button>` : ''}
          <button class="btn btn-danger btn-sm" onclick="delPayment(${p.id}, ${JSON.stringify(escapeHtml(p.name)).replace(/"/g,'&quot;')})">删除</button>
        </div>
      </td>
    </tr>
  `}).join('');
}

window.editPayment = async (id) => {
  const res = await fetch('/api/admin/payments?status=all');
  const data = await res.json();
  const p = data.payments.find(x => x.id === id);
  if (!p) return showToast('记录不存在');
  $('editId').value = p.id;
  $('editName').value = p.name;
  $('editAmount').value = (p.amount_cents / 100).toString();
  $('editRef').value = p.provider_ref || '';
  $('editNote').value = p.note || '';
  $('editStatus').value = p.status;
  $('editModal').hidden = false;
};

window.confirmPayment = async (id) => {
  if (!confirm('确认该笔支付已到账？确认后将立即上榜。')) return;
  const res = await fetch(`/api/admin/payments/${id}/confirm`, { method: 'POST' });
  if (res.ok) {
    showToast('已确认支付');
    await Promise.all([loadPayments(), loadStats(), loadLeaderboard()]);
  } else {
    showToast('确认失败');
  }
};

window.delPayment = async (id, name) => {
  if (!confirm(`确定删除「${name}」的这条支付记录？此操作不可撤销。`)) return;
  const res = await fetch(`/api/admin/payments/${id}`, { method: 'DELETE' });
  if (res.ok) {
    showToast('已删除');
    await Promise.all([loadPayments(), loadStats(), loadLeaderboard()]);
  } else showToast('删除失败');
};

// 编辑弹窗
$('editModal').querySelectorAll('[data-close-edit]').forEach(el => {
  el.addEventListener('click', () => { $('editModal').hidden = true; });
});
$('editForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = $('editId').value;
  const body = {
    name: $('editName').value.trim(),
    amount: Number($('editAmount').value),
    providerRef: $('editRef').value.trim() || null,
    note: $('editNote').value.trim() || null,
    status: $('editStatus').value,
  };
  const res = await fetch(`/api/admin/payments/${id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.ok) {
    $('editModal').hidden = true;
    showToast('已保存');
    await Promise.all([loadPayments(), loadStats(), loadLeaderboard()]);
  } else {
    const d = await res.json().catch(() => ({}));
    showToast(d.error || '保存失败');
  }
});

// 筛选
$('filterStatus').addEventListener('change', loadPayments);
$('searchInput').addEventListener('input', debounce(loadPayments, 300));
$('refreshBtn').addEventListener('click', () => Promise.all([loadPayments(), loadStats(), loadLeaderboard(), loadWithdrawals()]));

function debounce(fn, ms) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

// ---------- 榜单聚合 ----------
async function loadLeaderboard() {
  const res = await fetch('/api/leaderboard');
  const data = await res.json();
  const sym = state.config?.symbol || '$';
  $('lbCount').textContent = `${data.board.length} 位上榜者`;
  const body = $('lbBody');
  if (!data.board.length) {
    body.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:30px;">榜单为空</td></tr>`;
    return;
  }
  body.innerHTML = data.board.map(r => `
    <tr>
      <td>${r.rank <= 3 ? ['🥇','🥈','🥉'][r.rank-1] : r.rank}</td>
      <td>${escapeHtml(r.name)}</td>
      <td>${fmtMoney(r.total_cents, sym)}</td>
      <td>${r.payments}</td>
      <td>${fmtTime(r.last_paid_at)}</td>
    </tr>
  `).join('');
}

// ---------- 提款 ----------
$('withdrawForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = {
    amount: Number($('wAmount').value),
    method: $('wMethod').value.trim() || null,
    note: $('wNote').value.trim() || null,
  };
  const res = await fetch('/api/admin/withdrawals', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.ok) {
    $('wAmount').value = ''; $('wMethod').value = ''; $('wNote').value = '';
    showToast('提款已记录');
    await Promise.all([loadWithdrawals(), loadStats()]);
  } else {
    const d = await res.json().catch(() => ({}));
    showToast(d.error || '操作失败');
  }
});

async function loadWithdrawals() {
  const res = await fetch('/api/admin/withdrawals');
  const data = await res.json();
  const sym = state.config?.symbol || '$';
  const body = $('withdrawalsBody');
  if (!data.withdrawals.length) {
    body.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:30px;">暂无提款记录</td></tr>`;
    return;
  }
  body.innerHTML = data.withdrawals.map(w => `
    <tr>
      <td>${w.id}</td>
      <td>${fmtMoney(w.amount_cents, sym)}</td>
      <td>${escapeHtml(w.method || '—')}</td>
      <td><span class="status-badge ${w.status === 'processed' ? 'status-paid' : 'status-pending'}">${w.status === 'processed' ? '已处理' : '待处理'}</span></td>
      <td>${fmtTime(w.created_at)}</td>
      <td>${fmtTime(w.processed_at)}</td>
      <td>${w.status !== 'processed' ? `<button class="btn btn-primary btn-sm" onclick="markWithdrawal(${w.id})">标记已处理</button>` : '—'}</td>
    </tr>
  `).join('');
}

window.markWithdrawal = async (id) => {
  const res = await fetch(`/api/admin/withdrawals/${id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'processed' }),
  });
  if (res.ok) {
    showToast('已标记为已处理');
    await Promise.all([loadWithdrawals(), loadStats()]);
  }
};

// ---------- 支付通道接入配置 ----------
const MODE_LABELS = { redirect: '自动跳转', manual: '手动凭证', crypto: '加密货币', bank: '银行转账' };

async function loadProviders() {
  const grid = $('providersGrid');
  if (!grid) return;
  try {
    const res = await fetch('/api/admin/providers');
    const data = await res.json();
    const list = data.providers || [];
    if (!list.length) {
      grid.innerHTML = `<p style="color:var(--muted);text-align:center;padding:20px;">暂无已注册的支付方式</p>`;
      return;
    }
    grid.innerHTML = list.map(p => {
      const modeLabel = MODE_LABELS[p.mode] || p.mode;
      const envBadge = p.envReady
        ? `<span class="env-badge ready">已就绪</span>`
        : `<span class="env-badge not-ready">未配置</span>`;
      const fieldsHtml = (p.configFields || []).length
        ? (p.configFields || []).map(f => {
            const isSet = (p.fieldStatus || {})[f.key];
            return `<div class="pc-field">
              <span class="pc-field-label">${escapeHtml(f.label)}</span>
              <span class="pc-field-status ${isSet ? 'set' : 'unset'}">${isSet ? '已设置' : '未设置'}</span>
            </div>`;
          }).join('')
        : `<div class="pc-field"><span class="pc-field-label" style="color:var(--muted);">无需密钥（手动模式）</span></div>`;
      const webhookUrl = `${location.origin}${p.webhookPath}`;
      return `
        <div class="provider-card" id="pc-${p.id}">
          <div class="provider-card-head">
            <div class="provider-card-title">
              <span class="pc-name">${escapeHtml(p.label)}</span>
              <span class="pc-mode ${p.mode}">${modeLabel}</span>
            </div>
            ${envBadge}
          </div>
          <div class="pc-fields">${fieldsHtml}</div>
          <div class="pc-webhook">
            <span>Webhook:</span>
            <code>${escapeHtml(webhookUrl)}</code>
            <button class="btn-copy" onclick="copyText('${escapeHtml(webhookUrl)}')">复制</button>
          </div>
          <div class="pc-actions">
            ${p.envReady
              ? `<button class="btn btn-primary btn-sm" onclick="testProvider('${p.id}')">测试连通性</button>`
              : `<button class="btn btn-ghost btn-sm" onclick="testProvider('${p.id}')">测试连通性</button>`}
          </div>
          <div id="pc-result-${p.id}" class="pc-test-result" hidden></div>
        </div>
      `;
    }).join('');
  } catch (e) {
    grid.innerHTML = `<p style="color:var(--danger);text-align:center;padding:20px;">加载失败: ${escapeHtml(e.message)}</p>`;
  }
}

window.testProvider = async (id) => {
  const resultDiv = $(`pc-result-${id}`);
  if (resultDiv) {
    resultDiv.hidden = false;
    resultDiv.className = 'pc-test-result testing';
    resultDiv.textContent = '正在测试…';
  }
  try {
    const res = await fetch(`/api/admin/providers/${id}/test`, { method: 'POST' });
    const data = await res.json();
    if (resultDiv) {
      resultDiv.hidden = false;
      if (data.ok) {
        resultDiv.className = 'pc-test-result ok';
        resultDiv.textContent = data.message || '连通正常';
      } else {
        resultDiv.className = 'pc-test-result fail';
        resultDiv.textContent = data.reason || data.error || '测试失败';
      }
    }
  } catch (e) {
    if (resultDiv) {
      resultDiv.hidden = false;
      resultDiv.className = 'pc-test-result fail';
      resultDiv.textContent = `请求异常: ${e.message}`;
    }
  }
};

window.copyText = async (text) => {
  try {
    await navigator.clipboard.writeText(text);
    showToast('已复制');
  } catch (_) {
    // 降级：创建临时 textarea
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); showToast('已复制'); } catch (_) { showToast('复制失败'); }
    document.body.removeChild(ta);
  }
};

// 刷新按钮
if ($('refreshProvidersBtn')) $('refreshProvidersBtn').addEventListener('click', loadProviders);

// ---------- SSE ----------
function connectSSE() {
  if (state.sse) state.sse.close();
  try {
    const es = new EventSource('/api/stream');
    state.sse = es;
    es.addEventListener('admin', () => { loadStats(); loadPayments(); loadLeaderboard(); loadWithdrawals(); });
    es.addEventListener('leaderboard', () => { loadLeaderboard(); });
  } catch (_) {
    setInterval(() => { loadStats(); loadPayments(); loadLeaderboard(); loadWithdrawals(); }, 10000);
  }
}

// ---------- 启动 ----------
(async () => {
  const authed = await checkAuth();
  if (authed) enterAdmin();
  else $('loginView').hidden = false;
})();
