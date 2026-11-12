// lib/providers/jnhpay.js — 嘉年华支付 JNHPAY（多米尼加本地银行转账，gate_id=312）
//
// 官方规则（文档 + https://api.jnhpay.xyz/sign.html 实测确认）：
//   - POST + JSON；签名＝参数名升序、排除 sign 与空值、末尾 &key={KEY}、MD5 转大写
//   - 下单 /v1/order、查单 /v1/orderInfo、余额 /v1/balance
//   - 同步返回 {code:0|-1, msg, data}；最终结果以异步回调为准，应答纯文本 success
//   - amount 为主单位整数，平台实测范围 [10, 500000]（用 1.00 会被拒）
//   - 回调地址无需在平台预登记，下单时通过 notify_url 传入即可
//
// gate_id=312 是「多米尼加本地银行转账」通道；下面 4 个编码是该通道内的银行编码，
// 用来区分收款银行（非 SWIFT，仅在此网关体系内有效）。
import crypto from 'node:crypto';

const MERCHANT_ID = process.env.JNH_MERCHANT_ID || '';
const API_KEY = process.env.JNH_API_KEY || '';
const GATE_ID = process.env.JNH_GATE_ID || '312';
const BASE = (process.env.JNH_API_BASE || 'https://api.jnhpay.xyz').replace(/\/$/, '');
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
const ENABLED = String(process.env.JNH_ENABLED ?? 'false') === 'true';
// 文档写 bankCode，商户侧示例写 bank_code；实测两者均被平台接受，做成可切换
const BANK_CODE_FIELD = process.env.JNH_BANK_CODE_FIELD || 'bankCode';
const MIN_AMOUNT = 10;
const MAX_AMOUNT = 500000;

export const id = 'jnhpay';
export const CHANNELS = [
  { id: 'jnh_mercantil', label: 'Mercantil Santa Cruz (DO)', bankCode: '8274' },
  { id: 'jnh_bhd', label: 'BHD (DO)', bankCode: '1258' },
  { id: 'jnh_popular', label: 'Banco Popular (DO)', bankCode: '4152' },
  { id: 'jnh_banreservas', label: 'Banreservas (DO)', bankCode: '3435' },
];

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

function configFields() {
  return [
    { key: 'JNH_MERCHANT_ID', label: '商户编号' },
    { key: 'JNH_API_KEY', label: 'API 密钥' },
    { key: 'JNH_GATE_ID', label: '通道编号 gate_id' },
    { key: 'JNH_BANK_CODE_FIELD', label: '银行编码字段名 bankCode/bank_code' },
    { key: 'JNH_ENABLED', label: '启用开关 true/false' },
    { key: 'JNH_API_BASE', label: 'API 网关' },
    { key: 'JNH_CALLBACK_STRICT', label: '回调签名强制含 action=callback' },
  ];
}

// 构造一个具体银行通道的 provider 模块
export function makeProvider(channel) {
  const pid = channel.id;
  const label = channel.label;
  const bankCode = channel.bankCode;
  return {
    id: pid,
    getConfig() {
      return {
        id: pid, label, mode: 'redirect',
        enabled: ENABLED,
        demoFallback: false, // 真实资金通道，绝不回退 demo
        needKeys: ['JNH_MERCHANT_ID', 'JNH_API_KEY', 'JNH_ENABLED'],
        envReady: Boolean(MERCHANT_ID && API_KEY && ENABLED),
        configFields: configFields(),
        gateId: GATE_ID,
        bankCode,
        minAmount: MIN_AMOUNT, // 平台实测下限 10
      };
    },
    async createCheckout({ amountCents, successUrl }) {
      if (!MERCHANT_ID || !API_KEY) throw new Error('JNHPAY 未配置商户号或密钥');
      const amount = String(Math.round(amountCents / 100)); // 主单位整数
      if (!Number.isFinite(amountCents) || Number(amount) < MIN_AMOUNT || Number(amount) > MAX_AMOUNT) {
        throw new Error(`该通道金额需为 ${MIN_AMOUNT}~${MAX_AMOUNT} 的主单位整数`);
      }
      const outOrderNumber = `RY${Date.now()}${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
      const params = {
        merchant_id: MERCHANT_ID,
        out_order_number: outOrderNumber,
        amount,
        gate_id: GATE_ID,
        notify_url: `${PUBLIC_BASE_URL}/api/webhook/jnhpay`, // 平台无需预登记
      };
      params[BANK_CODE_FIELD] = bankCode;
      if (successUrl) params.jump_url = String(successUrl).replace('{REFERENCE}', outOrderNumber);
      params.sign = signParams(params);

      const data = await post('/v1/order', params);
      if (!data.pay_url) throw new Error('JNHPAY 未返回收银台地址 pay_url');
      return { mode: 'redirect', url: data.pay_url, providerRef: outOrderNumber, raw: data };
    },
    async verifyOrder(providerRef) {
      const params = { merchant_id: MERCHANT_ID, out_order_number: String(providerRef) };
      params.sign = signParams(params);
      const data = await post('/v1/orderInfo', params);
      return { paid: String(data.status) === '2', raw: data };
    },
    async verifyWebhook(rawBody) { return verifyWebhook(rawBody); },
  };
}

// 基础模块：注册中心保留，仅用于统一处理 webhook，不出现在前端支付方式列表
export function getConfig() {
  return {
    id, label: 'JNHPAY · 回调入口', mode: 'redirect',
    enabled: false, demoFallback: false,
    needKeys: [], envReady: false, configFields: configFields(),
  };
}

export async function getBalance() {
  const params = { merchant_id: MERCHANT_ID };
  params.sign = signParams(params);
  return post('/v1/balance', params);
}

// action 是网关自定义动作字段；action=callback 表示「异步交易结果通知」（Webhook），
// 由平台主动 POST 推送，用于同步订单状态，与主动查单接口无关。
// 文档写「签名中 action 固定值 callback」，但回调示例 JSON 里并未列出 action，
// 因此这里同时兼容两种签名口径：回调自带 action、或仅把 action=callback 参与签名。
export async function verifyWebhook(rawBody) {
  let event;
  try { event = JSON.parse(rawBody); } catch (_) { throw new Error('回调不是合法 JSON'); }
  if (!event || typeof event !== 'object') throw new Error('回调数据格式错误');
  const withAction = { ...event, action: 'callback' };
  const strict = String(process.env.JNH_CALLBACK_STRICT ?? 'false') === 'true';
  const okPlain = !strict && verifySign(event, event.sign);
  const okAction = verifySign(withAction, event.sign);
  if (!okPlain && !okAction) throw new Error('回调签名校验失败');
  return event;
}

export function isPaidCallback(event) {
  // 若回调带 action，只接受异步结果通知，忽略其他动作
  if (event?.action && String(event.action) !== 'callback') return false;
  return String(event?.status) === '2' && String(event?.callback_type || 'order') === 'order';
}

// 文档强调 real_amount「很重要，需要核对」；按主单位整数换算为分
export function callbackAmountCents(event) {
  const v = Number(event?.real_amount ?? event?.amount);
  return Number.isFinite(v) ? Math.round(v * 100) : null;
}
