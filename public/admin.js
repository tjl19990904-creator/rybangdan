// admin.js — 后台管理逻辑（多 Provider + 手动确认）
const $ = (id) => document.getElementById(id);
const state = { config: null, sse: null, pollTimer: null };

// ---------- 统一 API 请求 ----------
// 所有请求显式携带同源 Cookie；任何后台接口返回 401 时自动退回登录页并给出明确提示，
// 避免出现"页面显示已登录但数据一片空白、刷新也无效"的假登录死循环。
const nativeFetch = window.fetch.bind(window);
let sessionExpiredNotified = false;

function backToLogin(message) {
  if (state.sse) { state.sse.close(); state.sse = null; }
  if (state.pollTimer) { clearInterval(state.pollTimer); state.pollTimer = null; }
  $('adminView').hidden = true;
  $('loginView').hidden = false;
  $('loginPwd').value = '';
  const box = $('loginError');
  if (box) box.textContent = message || '';
}

async function apiFetch(url, opts = {}) {
  const res = await nativeFetch(url, { credentials: 'same-origin', cache: 'no-store', ...opts });
  const isAuthProbe = url.includes('/api/admin/me') || url.includes('/api/admin/login');
  if (res.status === 401 && !isAuthProbe) {
    if (!sessionExpiredNotified) {
      sessionExpiredNotified = true;
      backToLogin('登录已过期或会话失效，请重新输入密码');
    }
    throw new Error('SESSION_EXPIRED');
  }
  return res;
}

// 会话失效时并行请求会一起 reject，统一静默处理，避免控制台刷红字
window.addEventListener('unhandledrejection', (e) => {
  if (e.reason?.message === 'SESSION_EXPIRED') e.preventDefault();
});

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
  try {
    const res = await apiFetch('/api/admin/me', { cache: 'no-store' });
    return res.ok && (await res.json().catch(() => ({}))).authenticated === true;
  } catch (_) { return false; }
}

$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const pwd = $('loginPwd').value;
  const errBox = $('loginError');
  const btn = $('loginForm').querySelector('button[type="submit"]');
  errBox.textContent = '';
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = '登录中…';
  try {
    const res = await apiFetch('/api/admin/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pwd }),
    });
    if (res.ok) {
      sessionExpiredNotified = false;
      await enterAdmin();
    } else {
      const data = await res.json().catch(() => ({}));
      errBox.textContent = data.error || '登录失败，请稍后重试';
      $('loginPwd').select();
    }
  } catch (err) {
    errBox.textContent = '无法连接服务器，请检查网络后重试';
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
});

$('logoutBtn').addEventListener('click', async () => {
  try { await apiFetch('/api/admin/logout', { method: 'POST' }); } catch (_) {}
  backToLogin('');
});

async function enterAdmin() {
  $('loginView').hidden = true;
  $('adminView').hidden = false;
  try {
    await loadConfig();
    await Promise.allSettled([loadStats(), loadPayments(), loadProviders(), loadLeaderboard(), loadWithdrawals()]);
  } catch (err) {
    if (err?.message !== 'SESSION_EXPIRED') showToast('部分数据加载失败，请刷新重试');
  }
  connectSSE();
}

// ---------- 加载配置 ----------
async function loadConfig() {
  const res = await apiFetch('/api/config');
  state.config = await res.json();
  // 填充 provider 筛选
  const sel = $('filterProvider');
  sel.innerHTML = '<option value="all">全部方式</option>' +
    (state.config.providers || []).map(p => `<option value="${p.id}">${p.label}</option>`).join('');
  sel.addEventListener('change', loadPayments);
}

// ---------- 统计 ----------
async function loadStats() {
  const res = await apiFetch('/api/admin/stats');
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
  const res = await apiFetch(`/api/admin/payments?status=${encodeURIComponent(status)}&provider=${encodeURIComponent(provider)}&search=${encodeURIComponent(search)}`);
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
  const res = await apiFetch('/api/admin/payments?status=all');
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
  const res = await apiFetch(`/api/admin/payments/${id}/confirm`, { method: 'POST' });
  if (res.ok) {
    showToast('已确认支付');
    await Promise.all([loadPayments(), loadStats(), loadLeaderboard()]);
  } else {
    showToast('确认失败');
  }
};

window.delPayment = async (id, name) => {
  if (!confirm(`确定删除「${name}」的这条支付记录？此操作不可撤销。`)) return;
  const res = await apiFetch(`/api/admin/payments/${id}`, { method: 'DELETE' });
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
  const res = await apiFetch(`/api/admin/payments/${id}`, {
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
  const res = await apiFetch('/api/leaderboard');
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
  const res = await apiFetch('/api/admin/withdrawals', {
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
  const res = await apiFetch('/api/admin/withdrawals');
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
  const res = await apiFetch(`/api/admin/withdrawals/${id}`, {
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
    const res = await apiFetch('/api/admin/providers');
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
        <div class="provider-card ${p.isCustom ? 'custom' : ''}" id="pc-${p.id}">
          <div class="provider-card-head">
            <div class="provider-card-title">
              <span class="pc-name">${escapeHtml(p.label)}</span>
              <span class="pc-mode ${p.mode}">${modeLabel}</span>
              ${p.isCustom ? '<span class="pc-custom-tag">自定义</span>' : ''}
            </div>
            ${envBadge}
          </div>
          <div class="pc-fields">${fieldsHtml}</div>
          ${p.gateId ? `<div style="margin:6px 0 12px;font-size:12px;color:var(--muted);">通道号 gate_id: <code>${escapeHtml(p.gateId)}</code>${p.bankCode ? ` · 银行编码: <code>${escapeHtml(p.bankCode)}</code>` : ''}</div>` : ''}
          <div class="pc-webhook">
            <span>Webhook:</span>
            <code>${escapeHtml(webhookUrl)}</code>
            <button class="btn-copy" onclick="copyText('${escapeHtml(webhookUrl)}')">复制</button>
          </div>
          <div class="pc-actions">
            ${p.envReady
              ? `<button class="btn btn-primary btn-sm" onclick="testProvider('${p.id}')">测试连通性</button>`
              : `<button class="btn btn-ghost btn-sm" onclick="testProvider('${p.id}')">测试连通性</button>`}
            ${p.isCustom ? `<button class="btn btn-ghost btn-sm" onclick="editCustomProvider(${p.customId})">编辑</button>` : ''}
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
    const res = await apiFetch(`/api/admin/providers/${id}/test`, { method: 'POST' });
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

// ---------- 自定义支付通道管理 ----------
const PROVIDER_BUILTIN_IDS = ['stripe', 'paypal', 'airwallex', 'usdt', 'wise', 'payoneer', 'cashapp', 'alipay', 'wechat', 'bankcard', 'other'];

// 添加按钮
if ($('addProviderBtn')) $('addProviderBtn').addEventListener('click', () => openProviderModal());

// 弹窗关闭
$('providerModal').querySelectorAll('[data-close-pm]').forEach(el => {
  el.addEventListener('click', () => { $('providerModal').hidden = true; });
});

// 模式切换时显示/隐藏对应字段
$('cpMode').addEventListener('change', () => {
  updateProviderFieldVisibility();
});

function updateProviderFieldVisibility() {
  const mode = $('cpMode').value;
  const isCrypto = mode === 'crypto';
  const isBank = mode === 'bank';
  $('cpNetworkField').hidden = !isCrypto;
  $('cpQrField').hidden = !(isCrypto || mode === 'manual');
  $('cpHolderField').hidden = !isBank;
  $('cpBankField').hidden = !isBank;
  // 地址字段标签随模式变化
  const addrLabel = $('cpAddressField').querySelector('span');
  if (isCrypto) addrLabel.innerHTML = '钱包地址 <small style="color:var(--muted);">（必填）</small>';
  else if (isBank) addrLabel.innerHTML = '银行账号 <small style="color:var(--muted);">（可选）</small>';
  else addrLabel.innerHTML = '收款地址 / 账号 <small style="color:var(--muted);">（可选）</small>';
}

window.editCustomProvider = async (id) => {
  openProviderModal(id);
};

async function openProviderModal(id = null) {
  // 重置表单
  $('providerForm').reset();
  $('cpId').value = '';
  $('cpDeleteBtn').hidden = true;
  $('cpPid').disabled = false;
  updateProviderFieldVisibility();

  if (id) {
    // 编辑模式：加载数据
    $('providerModalTitle').textContent = '编辑自定义支付通道';
    try {
      const res = await apiFetch(`/api/admin/providers/custom/${id}`);
      const data = await res.json();
      const p = data.provider;
      if (!p) return showToast('通道不存在');
      $('cpId').value = p.id;
      $('cpPid').value = p.provider_id;
      $('cpPid').disabled = true; // ID 不可编辑
      $('cpLabel').value = p.label;
      $('cpMode').value = p.mode;
      const ins = p.instructions || {};
      $('cpAddress').value = ins.address || ins.account || '';
      $('cpHolder').value = ins.holder || '';
      $('cpBankName').value = ins.bankName || '';
      $('cpNetwork').value = ins.network || '';
      $('cpQrUrl').value = ins.qrUrl || '';
      $('cpNote').value = ins.note || '';
      $('cpEnabled').checked = p.enabled === 1;
      $('cpDeleteBtn').hidden = false;
      updateProviderFieldVisibility();
    } catch (e) {
      showToast('加载失败: ' + e.message);
      return;
    }
  } else {
    $('providerModalTitle').textContent = '添加自定义支付通道';
  }
  $('providerModal').hidden = false;
}

// 提交表单（创建/更新）
$('providerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = $('cpId').value;
  const providerId = $('cpPid').value.trim().toLowerCase();
  const label = $('cpLabel').value.trim();
  const mode = $('cpMode').value;
  const enabled = $('cpEnabled').checked;

  // 构建 instructions 对象
  const instructions = {};
  const addr = $('cpAddress').value.trim();
  const holder = $('cpHolder').value.trim();
  const bankName = $('cpBankName').value.trim();
  const network = $('cpNetwork').value.trim();
  const qrUrl = $('cpQrUrl').value.trim();
  const note = $('cpNote').value.trim();
  if (addr) instructions.address = addr;
  if (holder) instructions.holder = holder;
  if (bankName) instructions.bankName = bankName;
  if (network) instructions.network = network;
  if (qrUrl) instructions.qrUrl = qrUrl;
  if (note) instructions.note = note;

  // 基本校验
  if (!providerId) return showToast('请填写通道 ID');
  if (!/^[a-z0-9_-]+$/.test(providerId)) return showToast('ID 仅支持小写字母、数字、横线、下划线');
  if (PROVIDER_BUILTIN_IDS.includes(providerId)) return showToast(`ID「${providerId}」与内置通道冲突`);
  if (!label) return showToast('请填写显示名称');
  if (mode === 'crypto' && !addr) return showToast('加密货币模式需填写钱包地址');

  const body = { providerId, label, mode, instructions: Object.keys(instructions).length ? instructions : null, enabled };
  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true; btn.textContent = '保存中...';

  try {
    let res;
    if (id) {
      // 更新（不传 providerId，因为不可修改）
      res = await apiFetch(`/api/admin/providers/custom/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label, mode, instructions: body.instructions, enabled }),
      });
    } else {
      res = await apiFetch('/api/admin/providers/custom', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    }
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '操作失败');
    $('providerModal').hidden = true;
    showToast(id ? '已更新' : '已添加');
    await Promise.all([loadProviders(), loadConfig()]);
  } catch (e) {
    showToast(e.message);
  } finally {
    btn.disabled = false; btn.textContent = '保存';
  }
});

// 删除按钮
$('cpDeleteBtn').addEventListener('click', async () => {
  const id = $('cpId').value;
  if (!id) return;
  if (!confirm('确定删除此自定义支付通道？已产生的支付记录不受影响。')) return;
  try {
    const res = await apiFetch(`/api/admin/providers/custom/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      throw new Error(d.error || '删除失败');
    }
    $('providerModal').hidden = true;
    showToast('已删除');
    await Promise.all([loadProviders(), loadConfig()]);
  } catch (e) {
    showToast(e.message);
  }
});

// ---------- SSE ----------
function connectSSE() {
  if ($('loginView').hidden === false) return; // 已退回登录页则不再建立连接
  if (state.sse) state.sse.close();
  if (state.pollTimer) { clearInterval(state.pollTimer); state.pollTimer = null; }
  try {
    const es = new EventSource('/api/stream', { withCredentials: true });
    state.sse = es;
    const refresh = () => { loadStats(); loadPayments(); loadLeaderboard(); loadWithdrawals(); };
    es.addEventListener('admin', refresh);
    es.addEventListener('leaderboard', () => { loadLeaderboard(); });
    es.onerror = () => {
      if (!state.pollTimer) state.pollTimer = setInterval(refresh, 10000);
    };
  } catch (_) {
    if (!state.pollTimer) {
      state.pollTimer = setInterval(() => {
        loadStats(); loadPayments(); loadLeaderboard(); loadWithdrawals();
      }, 10000);
    }
  }
}

// ---------- 启动 ----------
(async () => {
  const hostEl = $('loginHost');
  if (hostEl) hostEl.textContent = `${location.host}/admin`;
  const authed = await checkAuth();
  if (authed) enterAdmin();
  else $('loginView').hidden = false;
})();
