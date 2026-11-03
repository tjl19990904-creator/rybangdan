// lib/providers/cashapp.js — Cash App Pay（独立商户能力有限，常见通过 Stripe 或手动）
const CASH_TAG = process.env.CASHAPP_CASHTAG || '';

export const id = 'cashapp';
export function getConfig() {
  return {
    id, label: 'Cash App', mode: 'manual', enabled: true, demoFallback: true,
    needKeys: ['CASHAPP_CASHTAG'],
    envReady: Boolean(CASH_TAG),
    configFields: [
      { key: 'CASHAPP_CASHTAG', label: 'Cashtag ($cashtag)' },
    ],
  };
}

export async function createCheckout({ name, amountCents, currency }) {
  if (!CASH_TAG) throw new Error('Cash App Cashtag 未配置');
  const ref = `RANK-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  return {
    mode: 'manual',
    providerRef: ref,
    instructions: {
      cashtag: CASH_TAG,
      amount: (amountCents / 100).toFixed(2),
      reference: ref,
      note: `请通过 Cash App 向 ${CASH_TAG} 支付 $${(amountCents / 100).toFixed(2)}，备注「${ref}」。`,
    },
    raw: { ref },
  };
}

export async function verifyOrder(providerRef) {
  return { paid: false, raw: { reason: '需后台核对 Cash App 到账' } };
}

export async function verifyWebhook(rawBody) {
  return JSON.parse(rawBody);
}
