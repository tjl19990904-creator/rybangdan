// lib/providers/payoneer.js — Payoneer：通常通过账户收款或请求付款（Request Payment）
const PAYEE_EMAIL = process.env.PAYONEER_PAYEE_EMAIL || '';
const API_USERNAME = process.env.PAYONEER_API_USERNAME || '';
const API_PASSWORD = process.env.PAYONEER_API_PASSWORD || '';

export const id = 'payoneer';
export function getConfig() {
  return {
    id, label: 'Payoneer', mode: 'manual', enabled: true, demoFallback: true,
    needKeys: ['PAYONEER_PAYEE_EMAIL'],
    envReady: Boolean(PAYEE_EMAIL),
    configFields: [
      { key: 'PAYONEER_PAYEE_EMAIL', label: 'Payee Email' },
    ],
  };
}

export async function createCheckout({ name, amountCents, currency }) {
  if (!PAYEE_EMAIL) throw new Error('Payoneer 收款邮箱未配置');
  const ref = `RANK-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  return {
    mode: 'manual',
    providerRef: ref,
    instructions: {
      payeeEmail: PAYEE_EMAIL,
      amount: (amountCents / 100).toFixed(2),
      currency: currency.toUpperCase(),
      reference: ref,
      note: `请通过 Payoneer「Make a Payment」向 ${PAYEE_EMAIL} 支付 ${(amountCents / 100).toFixed(2)} ${currency.toUpperCase()}，备注「${ref}」。`,
    },
    raw: { ref },
  };
}

export async function verifyOrder(providerRef) {
  // Payoneer 可通过 webhook 推送收款通知；无实时查询 API
  return { paid: false, raw: { reason: '需等待 Payoneer 到账通知或后台确认' } };
}

export async function verifyWebhook(rawBody) {
  return JSON.parse(rawBody);
}
