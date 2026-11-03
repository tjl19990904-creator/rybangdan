// lib/providers/bankcard.js — 银行卡收款：通常通过 Stripe 或银行转账，未配置时走手动流程
const BANK_NAME = process.env.BANK_NAME || '';
const BANK_ACCOUNT = process.env.BANK_ACCOUNT || '';
const BANK_HOLDER = process.env.BANK_HOLDER || '';
const BANK_SWIFT = process.env.BANK_SWIFT || '';

export const id = 'bankcard';
export function getConfig() {
  return {
    id, label: 'Bank Card', mode: 'bank', enabled: true, demoFallback: true,
    needKeys: ['BANK_ACCOUNT'],
    envReady: Boolean(BANK_ACCOUNT),
    configFields: [
      { key: 'BANK_NAME', label: 'Bank Name' },
      { key: 'BANK_ACCOUNT', label: 'Account Number' },
      { key: 'BANK_HOLDER', label: 'Account Holder' },
      { key: 'BANK_SWIFT', label: 'SWIFT Code (optional)' },
    ],
  };
}

export async function createCheckout({ name, amountCents, currency }) {
  if (!BANK_ACCOUNT) throw new Error('银行卡收款信息未配置');
  const ref = `RANK-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  return {
    mode: 'manual',
    providerRef: ref,
    instructions: {
      bankName: BANK_NAME,
      account: BANK_ACCOUNT,
      holder: BANK_HOLDER,
      swift: BANK_SWIFT || null,
      amount: (amountCents / 100).toFixed(2),
      currency: currency.toUpperCase(),
      reference: ref,
      note: `请向以下银行账户转账 ${(amountCents / 100).toFixed(2)} ${currency.toUpperCase()}，备注「${ref}」：\n${BANK_NAME}\n${BANK_ACCOUNT}\n${BANK_HOLDER}`,
    },
    raw: { ref },
  };
}

export async function verifyOrder(providerRef) {
  return { paid: false, raw: { reason: '需后台核对银行到账' } };
}

export async function verifyWebhook(rawBody) {
  return JSON.parse(rawBody);
}
