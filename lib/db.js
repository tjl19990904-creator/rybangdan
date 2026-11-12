// lib/db.js — 基于 Node 内置 node:sqlite 的持久化数据层
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'ranking.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS payments (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    name                TEXT NOT NULL,
    amount_cents        INTEGER NOT NULL,
    currency            TEXT NOT NULL DEFAULT 'usd',
    provider            TEXT NOT NULL DEFAULT 'other',
    provider_ref        TEXT,
    provider_meta       TEXT, -- JSON
    ip_address          TEXT, -- 支付来源IP
    stripe_session_id   TEXT,
    stripe_payment_intent TEXT,
    status              TEXT NOT NULL DEFAULT 'pending', -- pending | paid | refunded
    created_at          TEXT NOT NULL,
    paid_at             TEXT,
    note                TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
  CREATE INDEX IF NOT EXISTS idx_payments_name   ON payments(name);
  CREATE INDEX IF NOT EXISTS idx_payments_provider ON payments(provider);

  CREATE TABLE IF NOT EXISTS withdrawals (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    amount_cents INTEGER NOT NULL,
    currency     TEXT NOT NULL DEFAULT 'usd',
    method       TEXT,
    status       TEXT NOT NULL DEFAULT 'requested', -- requested | processed
    note         TEXT,
    created_at   TEXT NOT NULL,
    processed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS custom_providers (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    provider_id     TEXT NOT NULL UNIQUE,         -- 唯一标识，如 'alipay-biz'
    label           TEXT NOT NULL,                -- 显示名称，如 '支付宝(企业)'
    mode            TEXT NOT NULL DEFAULT 'manual', -- redirect | manual | crypto | bank
    instructions    TEXT,                          -- JSON: 手动支付说明（地址/账号/备注等）
    sort_order      INTEGER NOT NULL DEFAULT 0,
    enabled         INTEGER NOT NULL DEFAULT 1,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_custom_providers_enabled ON custom_providers(enabled);
`);

// 迁移：为已有 payments 表添加 ip_address 列（如果不存在）
// 必须在建 idx_payments_ip 索引之前执行，否则旧库会因「列不存在」直接启动失败
try {
  db.exec(`ALTER TABLE payments ADD COLUMN ip_address TEXT`);
  console.log('[db] 已添加 ip_address 列');
} catch (_) {
  // 列已存在，忽略
}
db.exec(`CREATE INDEX IF NOT EXISTS idx_payments_ip ON payments(ip_address)`);

export function nowISO() {
  return new Date().toISOString();
}

// ---------- 防刷校验 ----------
// 检查同一 IP 在最近几分钟内是否有相同金额的支付记录（防重复提交）
export function checkRateLimit(ipAddress, amountCents, windowMinutes = 3) {
  if (!ipAddress) return { allowed: true };
  const since = new Date(Date.now() - windowMinutes * 60_000).toISOString();
  const row = db.prepare(`
    SELECT COUNT(*) AS cnt FROM payments
    WHERE ip_address = ? AND amount_cents = ? AND created_at > ?
  `).get(ipAddress, amountCents, since);
  return {
    allowed: row.cnt === 0,
    count: row.cnt,
    windowMinutes,
  };
}

// 查询某用户的排名历史（所有已支付记录，按时间倒序）
export function getPaymentHistoryByName(name) {
  return db.prepare(`
    SELECT id, amount_cents, provider, status, created_at, paid_at, ip_address
    FROM payments
    WHERE name = ?
    ORDER BY created_at DESC
  `).all(name);
}

// ---------- 支付记录 ----------
export function createPayment({ name, amountCents, currency = 'usd', provider = 'other', providerRef = null, providerMeta = null, ipAddress = null, stripeSessionId = null, stripePaymentIntent = null, status = 'pending', paidAt = null, note = null }) {
  const metaJson = providerMeta ? JSON.stringify(providerMeta) : null;
  const stmt = db.prepare(`
    INSERT INTO payments (name, amount_cents, currency, provider, provider_ref, provider_meta, ip_address, stripe_session_id, stripe_payment_intent, status, created_at, paid_at, note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const info = stmt.run(name, amountCents, currency, provider, providerRef, metaJson, ipAddress, stripeSessionId, stripePaymentIntent, status, nowISO(), paidAt, note);
  return getPayment(Number(info.lastInsertRowid));
}

export function getPayment(id) {
  return db.prepare(`SELECT * FROM payments WHERE id = ?`).get(id);
}

export function getPaymentBySession(sessionId) {
  return db.prepare(`SELECT * FROM payments WHERE stripe_session_id = ?`).get(sessionId);
}

export function getPaymentByProviderRef(provider, ref) {
  return db.prepare(`SELECT * FROM payments WHERE provider = ? AND provider_ref = ?`).get(provider, ref);
}

// 按商户订单号查找（不限定 provider）：嘉年华支付 4 个银行通道共用一个回调入口
export function getPaymentByRef(ref) {
  return db.prepare(`SELECT * FROM payments WHERE provider_ref = ? ORDER BY id DESC LIMIT 1`).get(ref);
}

export function markPaymentPaid({ sessionId, provider, providerRef, paymentIntent = null, paidAt = nowISO() }) {
  if (sessionId) {
    db.prepare(`
      UPDATE payments
         SET status = 'paid', paid_at = ?, stripe_payment_intent = COALESCE(?, stripe_payment_intent)
       WHERE stripe_session_id = ? AND status != 'paid'
    `).run(paidAt, paymentIntent, sessionId);
    return getPaymentBySession(sessionId);
  }
  if (provider && providerRef) {
    db.prepare(`
      UPDATE payments
         SET status = 'paid', paid_at = ?
       WHERE provider = ? AND provider_ref = ? AND status != 'paid'
    `).run(paidAt, provider, providerRef);
    return getPaymentByProviderRef(provider, providerRef);
  }
  return null;
}

export function listPayments({ status, search, provider, limit = 200 } = {}) {
  const where = [];
  const params = [];
  if (status && status !== 'all') { where.push('status = ?'); params.push(status); }
  if (provider && provider !== 'all') { where.push('provider = ?'); params.push(provider); }
  if (search) { where.push('(name LIKE ? OR note LIKE ? OR stripe_session_id LIKE ? OR provider_ref LIKE ?)'); params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`); }
  const sql = `
    SELECT * FROM payments
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY (CASE WHEN status='paid' THEN 0 ELSE 1 END), paid_at DESC, created_at DESC
    LIMIT ?
  `;
  params.push(Number(limit));
  return db.prepare(sql).all(...params);
}

export function updatePayment(id, { name, amountCents, status, providerRef, providerMeta, note } = {}) {
  const fields = [];
  const params = [];
  if (name !== undefined) { fields.push('name = ?'); params.push(name); }
  if (amountCents !== undefined) { fields.push('amount_cents = ?'); params.push(amountCents); }
  if (status !== undefined) {
    fields.push('status = ?'); params.push(status);
    if (status === 'paid') { fields.push("paid_at = COALESCE(paid_at, ?)"); params.push(nowISO()); }
  }
  if (providerRef !== undefined) { fields.push('provider_ref = ?'); params.push(providerRef); }
  if (providerMeta !== undefined) { fields.push('provider_meta = ?'); params.push(providerMeta ? JSON.stringify(providerMeta) : null); }
  if (note !== undefined) { fields.push('note = ?'); params.push(note); }
  if (fields.length === 0) return getPayment(id);
  params.push(id);
  db.prepare(`UPDATE payments SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  return getPayment(id);
}

export function confirmPaymentManual(id, { providerRef, note } = {}) {
  const p = getPayment(id);
  if (!p) return null;
  const updates = { status: 'paid', paidAt: nowISO() };
  if (providerRef !== undefined) updates.providerRef = providerRef;
  if (note !== undefined) updates.note = note;
  return updatePayment(id, updates);
}

export function deletePayment(id) {
  return db.prepare(`DELETE FROM payments WHERE id = ?`).run(id);
}

// 榜单：按姓名聚合已支付金额，从高到低排序，并分配名次（同额同名次）
export function getLeaderboard() {
  const rows = db.prepare(`
    SELECT name,
           currency,
           SUM(amount_cents)        AS total_cents,
           COUNT(*)                 AS payments,
           MAX(paid_at)             AS last_paid_at
    FROM payments
    WHERE status = 'paid'
    GROUP BY name
    ORDER BY total_cents DESC, last_paid_at ASC
  `).all();

  let prev = null;
  let displayRank = 0;
  const ranked = rows.map((r, i) => {
    if (prev === null || r.total_cents !== prev) displayRank = i + 1;
    prev = r.total_cents;
    return { ...r, rank: displayRank };
  });
  return ranked;
}

// ---------- 提款 ----------
export function createWithdrawal({ amountCents, currency = 'usd', method = null, note = null }) {
  const info = db.prepare(`
    INSERT INTO withdrawals (amount_cents, currency, method, status, note, created_at)
    VALUES (?, ?, ?, 'requested', ?, ?)
  `).run(amountCents, currency, method, note, nowISO());
  return db.prepare(`SELECT * FROM withdrawals WHERE id = ?`).get(Number(info.lastInsertRowid));
}

export function listWithdrawals() {
  return db.prepare(`SELECT * FROM withdrawals ORDER BY created_at DESC`).all();
}

export function updateWithdrawal(id, { status } = {}) {
  const fields = [];
  const params = [];
  if (status !== undefined) {
    fields.push('status = ?'); params.push(status);
    if (status === 'processed') { fields.push('processed_at = ?'); params.push(nowISO()); }
  }
  if (fields.length === 0) return db.prepare(`SELECT * FROM withdrawals WHERE id = ?`).get(id);
  params.push(id);
  db.prepare(`UPDATE withdrawals SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  return db.prepare(`SELECT * FROM withdrawals WHERE id = ?`).get(id);
}

// ---------- 自定义支付通道 ----------
export function createCustomProvider({ providerId, label, mode = 'manual', instructions = null, sortOrder = 0, enabled = 1 }) {
  const now = nowISO();
  const info = db.prepare(`
    INSERT INTO custom_providers (provider_id, label, mode, instructions, sort_order, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(providerId, label, mode, instructions ? JSON.stringify(instructions) : null, sortOrder, enabled ? 1 : 0, now, now);
  return getCustomProvider(Number(info.lastInsertRowid));
}

export function getCustomProvider(id) {
  const row = db.prepare(`SELECT * FROM custom_providers WHERE id = ?`).get(id);
  if (row) row.instructions = row.instructions ? JSON.parse(row.instructions) : null;
  return row;
}

export function getCustomProviderByPid(providerId) {
  const row = db.prepare(`SELECT * FROM custom_providers WHERE provider_id = ?`).get(providerId);
  if (row) row.instructions = row.instructions ? JSON.parse(row.instructions) : null;
  return row;
}

export function listCustomProviders({ includeDisabled = false } = {}) {
  const sql = includeDisabled
    ? `SELECT * FROM custom_providers ORDER BY sort_order ASC, id ASC`
    : `SELECT * FROM custom_providers WHERE enabled = 1 ORDER BY sort_order ASC, id ASC`;
  const rows = db.prepare(sql).all();
  return rows.map(r => ({ ...r, instructions: r.instructions ? JSON.parse(r.instructions) : null }));
}

export function updateCustomProvider(id, { label, mode, instructions, sortOrder, enabled } = {}) {
  const fields = [];
  const params = [];
  if (label !== undefined) { fields.push('label = ?'); params.push(label); }
  if (mode !== undefined) { fields.push('mode = ?'); params.push(mode); }
  if (instructions !== undefined) { fields.push('instructions = ?'); params.push(instructions ? JSON.stringify(instructions) : null); }
  if (sortOrder !== undefined) { fields.push('sort_order = ?'); params.push(sortOrder); }
  if (enabled !== undefined) { fields.push('enabled = ?'); params.push(enabled ? 1 : 0); }
  if (fields.length === 0) return getCustomProvider(id);
  fields.push('updated_at = ?'); params.push(nowISO());
  params.push(id);
  db.prepare(`UPDATE custom_providers SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  return getCustomProvider(id);
}

export function deleteCustomProvider(id) {
  return db.prepare(`DELETE FROM custom_providers WHERE id = ?`).run(id);
}

// ---------- 财务统计 ----------
export function getStats() {
  const received = db.prepare(`
    SELECT COALESCE(SUM(amount_cents),0) AS total_received_cents,
           COUNT(*) AS paid_count
    FROM payments WHERE status = 'paid'
  `).get();

  const withdrawn = db.prepare(`
    SELECT COALESCE(SUM(amount_cents),0) AS total_withdrawn_cents,
           COUNT(*) AS withdrawn_count
    FROM withdrawals WHERE status = 'processed'
  `).get();

  const pending = db.prepare(`
    SELECT COALESCE(SUM(amount_cents),0) AS total_pending_cents,
           COUNT(*) AS pending_count
    FROM payments WHERE status = 'pending'
  `).get();

  const top = getLeaderboard()[0] || null;

  return {
    totalReceivedCents: received.total_received_cents,
    paidCount: received.paid_count,
    totalWithdrawnCents: withdrawn.total_withdrawn_cents,
    withdrawnCount: withdrawn.withdrawn_count,
    totalPendingCents: pending.total_pending_cents,
    pendingCount: pending.pending_count,
    netCents: received.total_received_cents - withdrawn.total_withdrawn_cents,
    topPayer: top ? { name: top.name, totalCents: top.total_cents } : null,
  };
}

// 首次运行可选写入示例数据
export function seedDemoData(enabled) {
  if (!enabled) return;
  const count = db.prepare(`SELECT COUNT(*) AS c FROM payments`).get().c;
  if (count > 0) return;
  const samples = [
    ['星辰科技', 99900], ['飞跃集团', 66600], ['云端网络', 42000],
    ['蓝海资本', 31800], ['极光工作室', 15000], ['晨曦基金', 8800],
  ];
  const stmt = db.prepare(`
    INSERT INTO payments (name, amount_cents, currency, provider, status, created_at, paid_at)
    VALUES (?, ?, 'usd', 'other', 'paid', ?, ?)
  `);
  const base = Date.now();
  samples.forEach(([name, cents], i) => {
    const t = new Date(base - i * 3600_000).toISOString();
    stmt.run(name, cents, t, t);
  });
  console.log('[db] 已写入示例榜单数据');
}

export default db;
