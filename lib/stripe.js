// lib/stripe.js — Stripe REST 封装（零依赖，使用 fetch + 手动 Webhook 验签）
import crypto from 'node:crypto';

const KEY = process.env.STRIPE_SECRET_KEY || '';
const WHSEC = process.env.STRIPE_WEBHOOK_SECRET || '';

// 是否启用真实 Stripe 支付；未配置则走演示模式
export const stripeEnabled = Boolean(KEY);

function authHeaders() {
  return {
    Authorization: `Bearer ${KEY}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  };
}

// 创建 Checkout Session（一次性支付）
export async function createCheckoutSession({ name, amountCents, currency, successUrl, cancelUrl }) {
  const body = new URLSearchParams();
  body.set('mode', 'payment');
  body.set('success_url', successUrl);
  body.set('cancel_url', cancelUrl);
  body.set('line_items[0][price_data][currency]', currency);
  body.set('line_items[0][price_data][product_data][name]', `榜单上榜 - ${name}`);
  body.set('line_items[0][price_data][unit_amount]', String(amountCents));
  body.set('line_items[0][quantity]', '1');
  body.set('payment_intent_data[metadata][name]', name);
  body.set('metadata[name]', name);
  body.set('metadata[amount_cents]', String(amountCents));

  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: authHeaders(),
    body,
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error?.message || `Stripe 错误 (${res.status})`);
  }
  return data; // { id, url, payment_intent, ... }
}

// 查询 Session（用于支付成功后二次确认）
export async function getSession(sessionId) {
  const res = await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}?expand[]=payment_intent`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${KEY}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `Stripe 错误 (${res.status})`);
  return data;
}

// 验证 Stripe Webhook 签名（兼容 v1 方案）
export function verifyWebhook(rawBody, signature) {
  if (!WHSEC) throw new Error('Webhook 密钥未配置');
  if (!signature) throw new Error('缺少签名头');
  const elements = signature.split(',');
  let timestamp = null;
  let v1 = null;
  for (const part of elements) {
    const [k, v] = part.split('=');
    if (k === 't') timestamp = v;
    else if (k === 'v1') v1 = v;
  }
  if (!timestamp || !v1) throw new Error('签名格式不正确');
  const signedPayload = `${timestamp}.${rawBody}`;
  const expected = crypto.createHmac('sha256', WHSEC).update(signedPayload).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(v1);
  if (a.length !== b.length) throw new Error('签名长度不匹配');
  if (!crypto.timingSafeEqual(a, b)) throw new Error('签名校验失败');
  // 重放保护：5 分钟窗口
  const ts = Number(timestamp) * 1000;
  if (Math.abs(Date.now() - ts) > 5 * 60 * 1000) throw new Error('签名已过期');
  return JSON.parse(rawBody);
}
