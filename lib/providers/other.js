// lib/providers/other.js — 其他支付方式：纯手动记录
export const id = 'other';
export function getConfig() {
  return {
    id, label: 'Other', mode: 'manual', enabled: true, demoFallback: true,
    needKeys: [],
    envReady: true,
  };
}

export async function createCheckout({ name, amountCents, currency }) {
  const ref = `RANK-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  return {
    mode: 'manual',
    providerRef: ref,
    instructions: {
      reference: ref,
      amount: (amountCents / 100).toFixed(2),
      currency: currency.toUpperCase(),
      note: 'Please complete the payment via the agreed method and enter the transaction ID or contact info below.',
    },
    raw: { ref },
  };
}

export async function verifyOrder(providerRef) {
  return { paid: false, raw: { reason: 'Requires manual confirmation in admin panel' } };
}

export async function verifyWebhook(rawBody) {
  return JSON.parse(rawBody);
}
