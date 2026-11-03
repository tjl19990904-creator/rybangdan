// server.js — 付费排名展示网站（多支付 Provider + Top 100 榜单）
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createPayment, getPayment, getPaymentBySession, getPaymentByProviderRef, markPaymentPaid,
  listPayments, updatePayment, deletePayment, getLeaderboard, confirmPaymentManual,
  createWithdrawal, listWithdrawals, updateWithdrawal, getStats, nowISO, seedDemoData,
  checkRateLimit, getPaymentHistoryByName,
} from './lib/db.js';
import { providerNames, getProvider, providerConfigDetail, getProviderStatus } from './lib/providers/index.js';
import { verifyPassword, createToken, verifyToken } from './lib/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------- 配置 ----------
const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const CURRENCY = process.env.CURRENCY || 'usd';
const CURRENCY_SYMBOL = process.env.CURRENCY_SYMBOL || '$';
const MIN_AMOUNT = Number(process.env.MIN_AMOUNT) || 1;
const SITE_NAME = process.env.SITE_NAME || '荣耀榜单';
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const SEED = String(process.env.SEED_DEMO_DATA ?? 'true') !== 'false';
const DEMO_AUTO_PAY = String(process.env.DEMO_AUTO_PAY ?? 'true') === 'true';

seedDemoData(SEED);

// ---------- SSE 客户端集合 ----------
const sseClients = new Set();
function broadcast(type, data) {
  const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    try { res.write(payload); } catch (_) { sseClients.delete(res); }
  }
}
function pushLeaderboard() { broadcast('leaderboard', getLeaderboard()); }
function pushAdmin() { broadcast('admin', { type: 'refresh', at: Date.now() }); }

// ---------- 工具函数 ----------
function sendJson(res, obj, status = 200, extraHeaders = {}) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders });
  res.end(body);
}
function sendError(res, status, message) { sendJson(res, { error: message }, status); }

function getCookies(req) {
  const out = {};
  const raw = req.headers.cookie;
  if (!raw) return out;
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k) out[k] = decodeURIComponent(v.join('='));
  }
  return out;
}

async function readJson(req, maxBytes = 256 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const c of req) {
    total += c.length;
    if (total > maxBytes) throw new Error('请求体过大');
    chunks.push(c);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}

async function readRaw(req, maxBytes = 512 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const c of req) {
    total += c.length;
    if (total > maxBytes) throw new Error('请求体过大');
    chunks.push(c);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function isValidAmount(amount) {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return false;
  if (amount <= 0) return false;
  const cents = Math.round(amount * 100);
  if (!Number.isInteger(cents) || cents < 1) return false;
  if (cents > 1_000_000_000) return false;
  return true;
}

// 获取客户端真实 IP（支持 Cloudflare / Render 反向代理）
function getClientIP(req) {
  const cfIP = req.headers['cf-connecting-ip'];
  if (cfIP) return cfIP;
  const xfwd = req.headers['x-forwarded-for'];
  if (xfwd) return xfwd.split(',')[0].trim();
  const realIP = req.headers['x-real-ip'];
  if (realIP) return realIP;
  return req.socket?.remoteAddress || null;
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};
function serveStatic(req, res, pathname) {
  if (pathname === '/') pathname = '/index.html';
  const filePath = path.join(PUBLIC_DIR, path.normalize(pathname));
  if (!filePath.startsWith(PUBLIC_DIR)) return sendError(res, 403, '禁止访问');
  fs.readFile(filePath, (err, data) => {
    if (err) return sendError(res, 404, '页面不存在');
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

function requireAdmin(req, res) {
  const token = getCookies(req).admin_token;
  if (!verifyToken(token)) { sendError(res, 401, '未授权，请先登录'); return false; }
  return true;
}

// ---------- Provider 回调处理 ----------
async function handleProviderCallback(res, providerId, providerRef) {
  const mod = getProvider(providerId);
  if (!mod || !mod.verifyOrder) return sendError(res, 400, '支付方式不存在或无法查询');
  try {
    const result = await mod.verifyOrder(providerRef);
    if (result.paid) {
      const existing = getPaymentByProviderRef(providerId, providerRef);
      if (existing && existing.status !== 'paid') {
        markPaymentPaid({ provider: providerId, providerRef });
        pushLeaderboard(); pushAdmin();
      }
    }
    return sendJson(res, { ok: true, paid: result.paid, raw: result.raw });
  } catch (e) {
    return sendError(res, 500, `查询失败: ${e.message}`);
  }
}

async function handleProviderWebhook(req, res, providerId) {
  const mod = getProvider(providerId);
  if (!mod || !mod.verifyWebhook) return sendError(res, 404, '支付方式不存在');
  try {
    const raw = await readRaw(req);
    const event = await mod.verifyWebhook(raw, req.headers['stripe-signature'] || req.headers);
    if (providerId === 'stripe' && event.type === 'checkout.session.completed') {
      const s = event.data.object;
      const existing = getPaymentBySession(s.id);
      const name = s.metadata?.name || '匿名';
      const amountCents = Number(s.metadata?.amount_cents) || s.amount_total || 0;
      const pi = typeof s.payment_intent === 'string' ? s.payment_intent : s.payment_intent?.id;
      if (existing) {
        if (existing.status !== 'paid') { markPaymentPaid({ sessionId: s.id, paymentIntent: pi }); pushLeaderboard(); pushAdmin(); }
      } else {
        createPayment({ name, amountCents, currency: s.currency || CURRENCY, provider: 'stripe', stripeSessionId: s.id, stripePaymentIntent: pi, status: 'paid', paidAt: nowISO() });
        pushLeaderboard(); pushAdmin();
      }
    }
    if (providerId === 'paypal' && (event.event_type === 'CHECKOUT.ORDER.APPROVED' || event.event_type === 'CHECKOUT.ORDER.COMPLETED')) {
      const id = event.resource?.id;
      if (id) await handleProviderCallback(res, 'paypal', id);
    }
    if (providerId === 'airwallex' && event.name === 'payment_intent.payment_success') {
      const id = event.data?.object?.id;
      if (id) await handleProviderCallback(res, 'airwallex', id);
    }
    return sendJson(res, { received: true });
  } catch (e) {
    console.error(`[webhook ${providerId}]`, e);
    return sendError(res, 400, `Webhook 处理失败: ${e.message}`);
  }
}

// ---------- 路由 ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;
  const method = req.method;

  if (method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
    return res.end();
  }

  try {
    // ---------- 公共 API ----------
    if (method === 'GET' && pathname === '/api/health') {
      const providers = providerNames();
      return sendJson(res, { ok: true, time: nowISO(), providers });
    }

    if (method === 'GET' && pathname === '/api/config') {
      return sendJson(res, {
        siteName: SITE_NAME, currency: CURRENCY, symbol: CURRENCY_SYMBOL,
        minAmount: MIN_AMOUNT, providers: providerNames(), demoAutoPay: DEMO_AUTO_PAY, time: nowISO(),
      });
    }

    if (method === 'GET' && pathname === '/api/leaderboard') {
      return sendJson(res, { board: getLeaderboard(), time: nowISO() });
    }

    // SSE 实时流
    if (method === 'GET' && pathname === '/api/stream') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.write('retry: 3000\n\n');
      res.write(`event: leaderboard\ndata: ${JSON.stringify(getLeaderboard())}\n\n`);
      sseClients.add(res);
      const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch (_) {} }, 25000);
      req.on('close', () => { clearInterval(ping); sseClients.delete(res); });
      return;
    }

    // 查询我的排名
    if (method === 'GET' && pathname === '/api/my-rank') {
      const name = url.searchParams.get('name');
      if (!name) return sendError(res, 400, '请提供姓名');
      const board = getLeaderboard();
      const me = board.find(r => r.name === name.trim());
      const total = board.length;
      if (!me) return sendJson(res, { found: false, total });
      const idx = board.findIndex(r => r.name === name.trim());
      const around = board.slice(Math.max(0, idx - 2), Math.min(total, idx + 3));
      return sendJson(res, { found: true, total, rank: me.rank, me, around });
    }

    // 查询用户支付历史（排名刷新记录）
    if (method === 'GET' && pathname === '/api/payment-history') {
      const name = url.searchParams.get('name');
      if (!name) return sendError(res, 400, '请提供姓名');
      const history = getPaymentHistoryByName(name.trim());
      return sendJson(res, { name: name.trim(), history });
    }

    // 创建支付
    if (method === 'POST' && pathname === '/api/checkout') {
      const body = await readJson(req);
      const name = String(body.name || '').trim().slice(0, 60);
      const amount = Number(body.amount);
      const providerId = String(body.provider || 'other').toLowerCase();
      if (!name) return sendError(res, 400, '请填写姓名');
      if (!isValidAmount(amount)) return sendError(res, 400, '金额无效');
      if (amount < MIN_AMOUNT) return sendError(res, 400, `最低上榜金额为 ${CURRENCY_SYMBOL}${MIN_AMOUNT}`);
      const amountCents = Math.round(amount * 100);

      // 获取客户端 IP 并进行防刷校验
      const clientIP = getClientIP(req);
      const rateCheck = checkRateLimit(clientIP, amountCents, 3);
      if (!rateCheck.allowed) {
        return sendError(res, 429, `操作过于频繁，相同金额请在 ${rateCheck.windowMinutes} 分钟后重试`);
      }

      const mod = getProvider(providerId);
      if (!mod) return sendError(res, 400, '支付方式不存在');
      const cfg = mod.getConfig();

      // 查询当前排名（用于支付后比较排名变化）
      const beforeBoard = getLeaderboard();
      const beforeRank = beforeBoard.findIndex(r => r.name === name.trim());
      const beforeData = beforeRank >= 0 ? { rank: beforeBoard[beforeRank].rank, total: beforeBoard[beforeRank].total_cents } : null;

      // 未配置真实密钥时：若 DEMO_AUTO_PAY=true 直接上榜；否则返回 manual 说明
      if (!cfg.envReady) {
        if (DEMO_AUTO_PAY) {
          const payment = createPayment({ name, amountCents, currency: CURRENCY, provider: providerId, providerRef: `demo-${Date.now()}`, ipAddress: clientIP, status: 'paid', paidAt: nowISO() });
          pushLeaderboard(); pushAdmin();
          // 计算支付后排名变化
          const afterBoard = getLeaderboard();
          const afterIdx = afterBoard.findIndex(r => r.name === name.trim());
          const afterData = afterIdx >= 0 ? { rank: afterBoard[afterIdx].rank, total: afterBoard[afterIdx].total_cents } : null;
          return sendJson(res, { mode: 'demo', provider: providerId, payment, beforeRank: beforeData, afterRank: afterData });
        }
        // 返回该方式的默认 manual 说明
        const manual = await mod.createCheckout({ name, amountCents, currency: CURRENCY });
        return sendJson(res, { mode: 'manual', provider: providerId, ...manual, beforeRank: beforeData });
      }

      try {
        const result = await mod.createCheckout({
          name, amountCents, currency: CURRENCY,
          successUrl: `${PUBLIC_BASE_URL}/success.html?provider=${providerId}&ref={REFERENCE}`,
          cancelUrl: `${PUBLIC_BASE_URL}/`,
        });

        // 统一将 {REFERENCE} 替换为实际 providerRef
        if (result.url) {
          result.url = result.url.replace(encodeURIComponent('{REFERENCE}'), encodeURIComponent(result.providerRef)).replace('{REFERENCE}', encodeURIComponent(result.providerRef));
        }

        // redirect 模式创建 pending 记录
        if (result.mode === 'redirect') {
          createPayment({ name, amountCents, currency: CURRENCY, provider: providerId, providerRef: result.providerRef, providerMeta: result.raw, ipAddress: clientIP, status: 'pending' });
          return sendJson(res, { mode: 'redirect', provider: providerId, url: result.url, providerRef: result.providerRef, beforeRank: beforeData });
        }

        // manual 模式创建 pending 记录
        const payment = createPayment({ name, amountCents, currency: CURRENCY, provider: providerId, providerRef: result.providerRef, providerMeta: result.raw, ipAddress: clientIP, status: 'pending' });
        return sendJson(res, { mode: 'manual', provider: providerId, instructions: result.instructions, providerRef: result.providerRef, payment, beforeRank: beforeData });
      } catch (e) {
        // 真实 API 失败且允许 demo fallback 时，回退到 demo 直接上榜
        if (cfg.demoFallback && DEMO_AUTO_PAY) {
          console.error(`[checkout ${providerId}] API 失败，回退 demo:`, e.message);
          const payment = createPayment({ name, amountCents, currency: CURRENCY, provider: providerId, providerRef: `demo-${Date.now()}`, ipAddress: clientIP, status: 'paid', paidAt: nowISO(), note: `API 回退: ${e.message}` });
          pushLeaderboard(); pushAdmin();
          const afterBoard = getLeaderboard();
          const afterIdx = afterBoard.findIndex(r => r.name === name.trim());
          const afterData = afterIdx >= 0 ? { rank: afterBoard[afterIdx].rank, total: afterBoard[afterIdx].total_cents } : null;
          return sendJson(res, { mode: 'demo', provider: providerId, fallbackReason: e.message, payment, beforeRank: beforeData, afterRank: afterData });
        }
        return sendError(res, 502, `支付创建失败: ${e.message}`);
      }
    }

    // 手动支付提交凭证/参考号
    if (method === 'POST' && pathname.startsWith('/api/checkout/')) {
      const paymentId = Number(pathname.split('/')[3]);
      if (!Number.isInteger(paymentId)) return sendError(res, 400, 'ID 无效');
      const body = await readJson(req);
      const ref = String(body.ref || '').trim();
      const note = String(body.note || '').trim();
      const p = getPayment(paymentId);
      if (!p) return sendError(res, 404, '支付记录不存在');
      if (p.status === 'paid') return sendJson(res, { ok: true, alreadyPaid: true });
      updatePayment(paymentId, { providerRef: ref || p.provider_ref, note });
      return sendJson(res, { ok: true, message: '凭证已提交，请等待后台确认' });
    }

    // 支付成功页二次确认
    if (method === 'GET' && pathname === '/api/verify') {
      const providerId = url.searchParams.get('provider') || 'stripe';
      const ref = url.searchParams.get('ref') || url.searchParams.get('session_id');
      if (!ref) return sendError(res, 400, '缺少 ref');
      const mod = getProvider(providerId);
      if (!mod || !mod.verifyOrder) return sendJson(res, { ok: true, provider: providerId, paid: false });
      try {
        const result = await mod.verifyOrder(ref);
        if (result.paid) {
          const existing = getPaymentByProviderRef(providerId, ref);
          if (existing && existing.status !== 'paid') {
            markPaymentPaid({ provider: providerId, providerRef: ref });
            pushLeaderboard(); pushAdmin();
          }
        }
        return sendJson(res, { ok: true, provider: providerId, paid: result.paid, raw: result.raw });
      } catch (e) {
        return sendError(res, 500, `查询失败: ${e.message}`);
      }
    }

    // 各 Provider 查询/回调
    if (method === 'GET' && pathname.startsWith('/api/callback/')) {
      const parts = pathname.split('/');
      const providerId = parts[3];
      const ref = url.searchParams.get('ref') || url.searchParams.get('token') || url.searchParams.get('id');
      if (!ref) return sendError(res, 400, '缺少 ref');
      return handleProviderCallback(res, providerId, ref);
    }

    // Webhook 统一入口
    if (method === 'POST' && pathname.startsWith('/api/webhook/')) {
      const providerId = pathname.split('/')[3];
      return handleProviderWebhook(req, res, providerId);
    }

    // 兼容旧 Stripe webhook 路径
    if (method === 'POST' && pathname === '/api/stripe/webhook') {
      return handleProviderWebhook(req, res, 'stripe');
    }

    // ---------- 后台鉴权 ----------
    if (method === 'POST' && pathname === '/api/admin/login') {
      const body = await readJson(req);
      if (!verifyPassword(body.password)) return sendError(res, 401, '密码错误');
      const token = createToken();
      return sendJson(res, { ok: true }, 200, {
        'Set-Cookie': `admin_token=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=86400`,
      });
    }

    if (method === 'POST' && pathname === '/api/admin/logout') {
      return sendJson(res, { ok: true }, 200, {
        'Set-Cookie': 'admin_token=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0',
      });
    }

    if (method === 'GET' && pathname === '/api/admin/me') {
      return sendJson(res, { ok: true });
    }

    // ---------- 后台受保护接口 ----------
    if (pathname.startsWith('/api/admin/')) {
      if (!requireAdmin(req, res)) return;

      if (method === 'GET' && pathname === '/api/admin/stats') {
        return sendJson(res, getStats());
      }

      if (method === 'GET' && pathname === '/api/admin/payments') {
        const status = url.searchParams.get('status') || 'all';
        const provider = url.searchParams.get('provider') || 'all';
        const search = url.searchParams.get('search') || '';
        return sendJson(res, { payments: listPayments({ status, provider, search }) });
      }

      if (method === 'DELETE' && pathname.startsWith('/api/admin/payments/')) {
        const id = Number(pathname.split('/').pop());
        if (!Number.isInteger(id)) return sendError(res, 400, 'ID 无效');
        deletePayment(id);
        pushLeaderboard(); pushAdmin();
        return sendJson(res, { ok: true });
      }

      if (method === 'PATCH' && pathname.startsWith('/api/admin/payments/')) {
        const id = Number(pathname.split('/').pop());
        if (!Number.isInteger(id)) return sendError(res, 400, 'ID 无效');
        const body = await readJson(req);
        const patch = {};
        if (body.name !== undefined) patch.name = String(body.name).trim().slice(0, 60);
        if (body.amount !== undefined) {
          if (!isValidAmount(Number(body.amount))) return sendError(res, 400, '金额无效');
          patch.amountCents = Math.round(Number(body.amount) * 100);
        }
        if (body.status !== undefined) {
          if (!['pending', 'paid', 'refunded'].includes(body.status)) return sendError(res, 400, '状态无效');
          patch.status = body.status;
        }
        if (body.providerRef !== undefined) patch.providerRef = String(body.providerRef).trim() || null;
        if (body.note !== undefined) patch.note = String(body.note).trim() || null;
        const updated = updatePayment(id, patch);
        pushLeaderboard(); pushAdmin();
        return sendJson(res, { payment: updated });
      }

      // 后台手动确认支付
      if (method === 'POST' && pathname.startsWith('/api/admin/payments/') && pathname.endsWith('/confirm')) {
        const id = Number(pathname.split('/')[4]);
        if (!Number.isInteger(id)) return sendError(res, 400, 'ID 无效');
        const body = await readJson(req);
        const p = confirmPaymentManual(id, { providerRef: body.providerRef, note: body.note });
        if (!p) return sendError(res, 404, '记录不存在');
        pushLeaderboard(); pushAdmin();
        return sendJson(res, { payment: p });
      }

      // 提款
      if (method === 'GET' && pathname === '/api/admin/withdrawals') {
        return sendJson(res, { withdrawals: listWithdrawals() });
      }

      if (method === 'POST' && pathname === '/api/admin/withdrawals') {
        const body = await readJson(req);
        const amount = Number(body.amount);
        if (!isValidAmount(amount)) return sendError(res, 400, '金额无效');
        const w = createWithdrawal({
          amountCents: Math.round(amount * 100), currency: CURRENCY,
          method: body.method || null, note: body.note || null,
        });
        pushAdmin();
        return sendJson(res, { withdrawal: w });
      }

      if (method === 'PATCH' && pathname.startsWith('/api/admin/withdrawals/')) {
        const id = Number(pathname.split('/').pop());
        if (!Number.isInteger(id)) return sendError(res, 400, 'ID 无效');
        const body = await readJson(req);
        const w = updateWithdrawal(id, { status: body.status });
        pushAdmin();
        return sendJson(res, { withdrawal: w });
      }

      // 支付通道接入配置
      if (method === 'GET' && pathname === '/api/admin/providers') {
        return sendJson(res, { providers: providerConfigDetail() });
      }

      if (method === 'GET' && pathname.startsWith('/api/admin/providers/') && !pathname.includes('/test')) {
        const pid = pathname.split('/').pop();
        const detail = getProviderStatus(pid);
        if (!detail) return sendError(res, 404, '支付方式不存在');
        return sendJson(res, { provider: detail });
      }

      // 测试某支付通道的 API 连通性（对 redirect 类发起一次 createCheckout 试调用）
      if (method === 'POST' && pathname.startsWith('/api/admin/providers/') && pathname.endsWith('/test')) {
        const parts = pathname.split('/');
        const pid = parts[4];
        const mod = getProvider(pid);
        if (!mod) return sendError(res, 404, '支付方式不存在');
        const cfg = mod.getConfig();
        if (!cfg.envReady) return sendJson(res, { ok: false, reason: '未配置真实密钥（当前为演示/手动模式）' });
        try {
          if (mod.createCheckout) {
            await mod.createCheckout({ name: 'Connection Test', amountCents: 100, currency: CURRENCY, successUrl: `${PUBLIC_BASE_URL}/`, cancelUrl: `${PUBLIC_BASE_URL}/` });
          }
          return sendJson(res, { ok: true, message: 'API 连通正常' });
        } catch (e) {
          return sendJson(res, { ok: false, reason: e.message });
        }
      }

      return sendError(res, 404, '接口不存在');
    }

    // ---------- 静态资源 ----------
    return serveStatic(req, res, pathname);
  } catch (err) {
    console.error('[server] 请求异常:', err);
    return sendError(res, 500, err.message || '服务器内部错误');
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  ✓ 付费排名展示网站已启动`);
  console.log(`    榜单页: ${PUBLIC_BASE_URL}/`);
  console.log(`    后台页: ${PUBLIC_BASE_URL}/admin.html`);
  console.log(`    已加载支付方式: ${providerNames().map(p => p.label).join(' / ') || '无'}\n`);
});
