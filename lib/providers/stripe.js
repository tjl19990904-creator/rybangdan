// lib/providers/stripe.js — Stripe Checkout Session（真实 API）
import crypto from 'node:crypto';

const KEY = process.env.STRIPE_SECRET_KEY || '';
const WHSEC = process.env.STRIPE_WEBHOOK_SECRET || '';

export const id = 'stripe';
export function getConfig() {
  return {
    id, label: 'Stripe', mode: 'redirect', enabled: true, demoFallback: true,
    needKeys: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'],
    envReady: Boolean(KEY),
    configFields: [
      { key: 'STRIPE_SECRET_KEY', label: 'Secret Key' },
      { key: 'STRIPE_WEBHOOK_SECRET', label: 'Webhook Signing Secret' },
    ],
  };
}

function authHeaders() {
  return {
    Authorization: `Bearer ${KEY}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  };
}

export async function createCheckout({ name, amountCents, currency, successUrl, cancelUrl }) {
  if (!KEY) throw new Error('STRIPE_SECRET_KEY 未配置');
  const body = new URLSearchParams();
  body.set('mode', 'payment');
  body.set('success_url', successUrl);
  body.set('cancel_url', cancelUrl);
  body.set('line_items[0][price_data][currency]', currency);
  body.set('line_items[0][price_data][product_data][name]', `榜单上榜 - ${name}`);
  body.set('line_items[0][price_data][unit_amount]', String(amountCents));
  body.set('line_items[0][quantity]', '1');
  body.set('payment_intent_data[metadata][name]', name);
  body.set('payment_intent_data[metadata][amount_cents]', String(amountCents));
  body.set('metadata[name]', name);
  body.set('metadata[amount_cents]', String(amountCents));
  body.set('metadata[provider]', 'stripe');

  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST', headers: authHeaders(), body,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `Stripe 错误 (${res.status})`);
  return {
    mode: 'redirect',
    url: data.url,
    providerRef: data.id,
    raw: { sessionId: data.id },
  };
}

export async function getSession(sessionId) {
  const res = await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}?expand[]=payment_intent`, {
    headers: { Authorization: `Bearer ${KEY}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `Stripe 错误 (${res.status})`);
  return data;
}

export function verifyWebhook(rawBody, signature) {
  if (!WHSEC) throw new Error('STRIPE_WEBHOOK_SECRET 未配置');
  const elements = String(signature || '').split(',');
  let timestamp = null, v1 = null;
  for (const part of elements) {
    const [k, v] = part.split('=');
    if (k === 't') timestamp = v; else if (k === 'v1') v1 = v;
  }
  if (!timestamp || !v1) throw new Error('签名格式不正确');
  const expected = crypto.createHmac('sha256', WHSEC).update(`${timestamp}.${rawBody}`).digest('hex');
  const a = Buffer.from(expected), b = Buffer.from(v1);
  if (a.length !== b.length) throw new Error('签名长度不匹配');
  if (!crypto.timingSafeEqual(a, b)) throw new Error('签名校验失败');
  if (Math.abs(Date.now() - Number(timestamp) * 1000) > 5 * 60 * 1000) throw new Error('签名已过期');
  return JSON.parse(rawBody);
}

export async function verifyOrder(providerRef) {
  const s = await getSession(providerRef);
  return { paid: s.payment_status === 'paid', raw: s };
}
