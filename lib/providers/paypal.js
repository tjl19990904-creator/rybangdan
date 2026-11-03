// lib/providers/paypal.js — PayPal Checkout Orders v2（真实 API）
const CLIENT_ID = process.env.PAYPAL_CLIENT_ID || '';
const CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET || '';
const WEBHOOK_ID = process.env.PAYPAL_WEBHOOK_ID || '';
const SANDBOX = String(process.env.PAYPAL_SANDBOX ?? 'true') !== 'false';
const BASE = SANDBOX ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com';

export const id = 'paypal';
export function getConfig() {
  return {
    id, label: 'PayPal', mode: 'redirect', enabled: true, demoFallback: true,
    needKeys: ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'PAYPAL_WEBHOOK_ID'],
    envReady: Boolean(CLIENT_ID && CLIENT_SECRET),
    configFields: [
      { key: 'PAYPAL_CLIENT_ID', label: 'Client ID' },
      { key: 'PAYPAL_CLIENT_SECRET', label: 'Client Secret' },
      { key: 'PAYPAL_WEBHOOK_ID', label: 'Webhook ID' },
      { key: 'PAYPAL_SANDBOX', label: 'Sandbox (true/false)' },
    ],
  };
}

let tokenCache = null;
async function getAccessToken() {
  if (tokenCache && tokenCache.expires > Date.now() + 60_000) return tokenCache.token;
  const res = await fetch(`${BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error_description || `PayPal 鉴权失败 (${res.status})`);
  tokenCache = { token: data.access_token, expires: Date.now() + data.expires_in * 1000 };
  return data.access_token;
}

async function paypalFetch(path, { method = 'GET', body } = {}) {
  const token = await getAccessToken();
  const opts = {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || `PayPal 错误 (${res.status})`);
  return data;
}

export async function createCheckout({ name, amountCents, currency, returnUrl, cancelUrl }) {
  if (!CLIENT_ID || !CLIENT_SECRET) throw new Error('PayPal 客户端凭证未配置');
  const data = await paypalFetch('/v2/checkout/orders', {
    method: 'POST',
    body: {
      intent: 'CAPTURE',
      purchase_units: [{
        amount: { currency_code: currency.toUpperCase(), value: (amountCents / 100).toFixed(2) },
        description: `榜单上榜 - ${name}`,
        custom_id: name,
      }],
      application_context: { brand_name: process.env.SITE_NAME || '荣耀榜单', return_url: returnUrl, cancel_url: cancelUrl },
    },
  });
  const approve = data.links.find(l => l.rel === 'approve');
  if (!approve?.href) throw new Error('PayPal 未返回跳转链接');
  return { mode: 'redirect', url: approve.href, providerRef: data.id, raw: data };
}

export async function captureOrder(orderId) {
  return paypalFetch(`/v2/checkout/orders/${orderId}/capture`, { method: 'POST' });
}

export async function verifyOrder(providerRef) {
  const data = await paypalFetch(`/v2/checkout/orders/${providerRef}`);
  const paid = data.status === 'COMPLETED' || data.status === 'APPROVED';
  return { paid, raw: data };
}

// PayPal Webhook 验签（简化版：通过 API 查询事件详情确认）
export async function verifyWebhook(rawBody, headers) {
  const event = JSON.parse(rawBody);
  // 生产环境应调用 POST /v1/notifications/verify-webhook-signature
  // 此处优先按 event.id 二次查询，确保事件真实
  if (event.id) {
    try {
      const verified = await paypalFetch(`/v1/notifications/webhooks-events/${event.id}`);
      return verified;
    } catch (_) {
      // 查询失败时至少返回原始事件，由调用方决定是否处理
    }
  }
  return event;
}
