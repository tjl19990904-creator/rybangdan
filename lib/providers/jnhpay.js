// lib/providers/jnhpay.js — 嘉年华支付 JNHPAY（代收 / 多米尼加通道）
//
// 依据对接文档（ShowDoc jnhpay3，10 章）实现：
//   - POST + JSON、UTF-8
//   - 签名：参数按 ASCII 字典序、空值不参与、排除 sign，拼 k=v&k=v 后追加 &key={KEY}，MD5 转大写
//   - 下单 POST /v1/order，查单 POST /v1/orderInfo，余额 POST /v1/balance
//   - 同步返回 { code: 0|-1, msg, data }；最终结果以异步回调为准，应答 success
//
// 【重要】以下细节文档未写清，全部做成可配置开关，未经沙箱验证前通道默认禁用：
//   1. gate_id 取值（312 与 8274/1258/4152/3435 的层级关系）
//   2. 回调签名中「action 固定值 callback」的确切含义
//   3. amount 单位（主单位 or 分）
//   4. 文档示例 SIGN 值无法按其示例参数复现，需在沙箱用真实订单核对签名
import crypto from 'node:crypto';

const MERCHANT_ID = process.env.JNH_MERCHANT_ID || '';
const API_KEY = process.env.JNH_API_KEY || '';
const GATE_ID = process.env.JNH_GATE_ID || '';
const BANK_CODE = process.env.JNH_BANK_CODE || '';
const BASE = (process.env.JNH_API_BASE || 'https://api.jnhpay.xyz').replace(/\/$/, '');
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
const ENABLED = String(process.env.JNH_ENABLED ?? 'false') === 'true';
const CALLBACK_ACTION = String(process.env.JNH_CALLBACK_ACTION ?? 'false') === 'true';
const AMOUNT_MODE = process.env.JNH_AMOUNT_MODE || 'major'; // major | cents

export const id = 'jnhpay';

// 与文档 PHP 示例保持一致：ksort -> 跳过 sign/空值/数组 -> k=v& -> &key=KEY -> strtoupper(md5)
export function signParams(params, key = API_KEY) {
  const buff = Object.keys(params)
    .filter(k => k !== 'sign' && params[k] !== '' && params[k] !== null && params[k] !== undefined && typeof params[k] !== 'object')
    .sort()
    .map(k => `${k}=${params[k]}`)
    .join('&');
  return crypto.createHash('md5').update(`${buff}&key=${key}`, 'utf8').digest('hex').toUpperCase();
}

export function verifySign(params, sign, key = API_KEY) {
  const expected = signParams(params, key);
  const a = Buffer.from(String(sign || ''));
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

async function post(path, params) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`JNHPAY HTTP ${res.status}`);
  if (Number(data.code) !== 0) throw new Error(data.msg || `JNHPAY 返回 code=${data.code}`);
  return data.data || {};
}

export function getConfig() {
  return {
    id,
    label: 'JNHPAY · Dominican',
    mode: 'redirect',
    enabled: ENABLED,
    demoFallback: false, // 真实资金通道，绝不回退到 demo 直接上榜
    needKeys: ['JNH_MERCHANT_ID', 'JNH_API_KEY', 'JNH_GATE_ID', 'JNH_ENABLED'],
    envReady: Boolean(MERCHANT_ID && API_KEY && GATE_ID && ENABLED),
    configFields: [
      { key: 'JNH_MERCHANT_ID', label: '商户编号' },
      { key: 'JNH_API_KEY', label: 'API 密钥' },
      { key: 'JNH_GATE_ID', label: '通道编号 gate_id' },
      { key: 'JNH_BANK_CODE', label: '银行编码 bankCode（可选）' },
      { key: 'JNH_ENABLED', label: '启用开关 true/false' },
      { key: 'JNH_API_BASE', label: 'API 网关' },
      { key: 'JNH_AMOUNT_MODE', label: '金额单位 major/cents' },
      { key: 'JNH_CALLBACK_ACTION', label: '回调签名含 action=callback' },
    ],
  };
}

export async function createCheckout({ name, amountCents, successUrl }) {
  if (!MERCHANT_ID || !API_KEY || !GATE_ID) throw new Error('JNHPAY 未配置完整（商户号/密钥/通道编号）');
  const outOrderNumber = `RY${Date.now()}${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  const amount = AMOUNT_MODE === 'cents' ? String(amountCents) : (amountCents / 100).toFixed(2);
  const params = {
    merchant_id: MERCHANT_ID,
    out_order_number: outOrderNumber,
    amount,
    gate_id: GATE_ID,
    notify_url: `${PUBLIC_BASE_URL}/api/webhook/jnhpay`,
  };
  if (BANK_CODE) params.bankCode = BANK_CODE;
  if (successUrl) params.jump_url = String(successUrl).replace('{REFERENCE}', outOrderNumber);
  params.sign = signParams(params);

  const data = await post('/v1/order', params);
  if (!data.pay_url) throw new Error('JNHPAY 未返回收银台地址 pay_url');
  return { mode: 'redirect', url: data.pay_url, providerRef: outOrderNumber, raw: data };
}

export async function verifyOrder(providerRef) {
  const params = { merchant_id: MERCHANT_ID, out_order_number: String(providerRef) };
  params.sign = signParams(params);
  const data = await post('/v1/orderInfo', params);
  return { paid: String(data.status) === '2', raw: data };
}

export async function getBalance() {
  const params = { merchant_id: MERCHANT_ID };
  params.sign = signParams(params);
  return post('/v1/balance', params);
}

// 回调验签：文档提到「签名中 action 固定值 callback」，含义未明确，
// 默认按标准规则验签；若平台实际要求 action 参与签名，把 JNH_CALLBACK_ACTION 设为 true。
export async function verifyWebhook(rawBody) {
  let event;
  try { event = JSON.parse(rawBody); } catch (_) { throw new Error('回调不是合法 JSON'); }
  if (!event || typeof event !== 'object') throw new Error('回调数据格式错误');
  const params = { ...event };
  if (CALLBACK_ACTION) params.action = 'callback';
  if (!verifySign(params, event.sign)) throw new Error('回调签名校验失败');
  return event;
}

export function isPaidCallback(event) {
  return String(event?.status) === '2' && String(event?.callback_type || 'order') === 'order';
}

// 文档强调 real_amount「很重要，需要核对」，用于防止金额篡改
export function callbackAmountCents(event) {
  const v = Number(event?.real_amount ?? event?.amount);
  return Number.isFinite(v) ? Math.round(v * 100) : null;
}

export default { id, getConfig, createCheckout, verifyOrder, verifyWebhook, signParams, verifySign, isPaidCallback, callbackAmountCents };
