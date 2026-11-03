// lib/providers/airwallex.js — Airwallex Payment Intent（真实 API 接入）
const CLIENT_ID = process.env.AIRWALLEX_CLIENT_ID || '';
const API_KEY = process.env.AIRWALLEX_API_KEY || '';
const ACCOUNT_ID = process.env.AIRWALLEX_ACCOUNT_ID || '';
const SANDBOX = String(process.env.AIRWALLEX_SANDBOX ?? 'true') !== 'false';
const BASE = SANDBOX ? 'https://api-demo.airwallex.com' : 'https://api.airwallex.com';

export const id = 'airwallex';
export function getConfig() {
  return {
    id, label: 'Airwallex', mode: 'redirect', enabled: true, demoFallback: true,
    needKeys: ['AIRWALLEX_CLIENT_ID', 'AIRWALLEX_API_KEY'],
    envReady: Boolean(CLIENT_ID && API_KEY),
    configFields: [
      { key: 'AIRWALLEX_CLIENT_ID', label: 'Client ID' },
      { key: 'AIRWALLEX_API_KEY', label: 'API Key' },
      { key: 'AIRWALLEX_ACCOUNT_ID', label: 'Account ID (optional)' },
      { key: 'AIRWALLEX_SANDBOX', label: 'Sandbox (true/false)' },
    ],
  };
}

let tokenCache = null;
async function getToken() {
  if (tokenCache && tokenCache.expires > Date.now() + 60_000) return tokenCache.token;
  const res = await fetch(`${BASE}/api/v1/authentication/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
      'x-client-id': CLIENT_ID,
    },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.message || `Airwallex 鉴权失败 (${res.status})`);
  tokenCache = { token: data.token, expires: Date.now() + (data.expires_in || 1800) * 1000 };
  return data.token;
}

async function airwallexFetch(path, { method = 'GET', body } = {}) {
  const token = await getToken();
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
  if (ACCOUNT_ID) headers['x-on-behalf-of'] = ACCOUNT_ID;
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || `Airwallex 错误 (${res.status})`);
  return data;
}

export async function createCheckout({ name, amountCents, currency, returnUrl, cancelUrl }) {
  if (!CLIENT_ID || !API_KEY) throw new Error('Airwallex 凭证未配置');
  const intent = await airwallexFetch('/api/v1/pa/payment_intents/create', {
    method: 'POST',
    body: {
      request_id: `rank_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      amount: amountCents / 100,
      currency: currency.toUpperCase(),
      merchant_order_id: `rank_${Date.now()}`,
      descriptor: `Rank ${name}`.slice(0, 32),
    },
  });
  // 创建 hosted payment page 或返回 client_secret 由前端 SDK 渲染
  // 这里使用 Airwallex checkout 跳转链接（生产环境按官方 HPP 地址拼接）
  const hppUrl = `${BASE}/pa/api/v1/payment_intents/${intent.id}/confirm?return_url=${encodeURIComponent(returnUrl)}&cancel_url=${encodeURIComponent(cancelUrl)}`;
  return { mode: 'redirect', url: hppUrl, providerRef: intent.id, raw: intent };
}

export async function verifyOrder(providerRef) {
  const data = await airwallexFetch(`/api/v1/pa/payment_intents/${providerRef}`);
  const paid = data.status === 'SUCCEEDED' || data.status === 'REQUIRE_CAPTURE';
  return { paid, raw: data };
}

export async function verifyWebhook(rawBody) {
  // Airwallex webhook 包含 event_id，可通过 API 二次查询确认
  const event = JSON.parse(rawBody);
  return event;
}
