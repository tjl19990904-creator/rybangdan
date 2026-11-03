// lib/providers/wise.js — Wise / TransferWise：收款通常通过银行账户转账，使用参考号匹配
const PROFILE_ID = process.env.WISE_PROFILE_ID || '';
const API_KEY = process.env.WISE_API_KEY || '';
const ACCOUNT_HOLDER = process.env.WISE_ACCOUNT_HOLDER || '';
const ACCOUNT_NUMBER = process.env.WISE_ACCOUNT_NUMBER || '';
const BANK_CODE = process.env.WISE_BANK_CODE || '';
const CURRENCY = process.env.CURRENCY || 'usd';

export const id = 'wise';
export function getConfig() {
  return {
    id, label: 'Wise', mode: 'bank', enabled: true, demoFallback: true,
    needKeys: ['WISE_ACCOUNT_NUMBER'],
    envReady: Boolean(ACCOUNT_NUMBER),
    configFields: [
      { key: 'WISE_ACCOUNT_HOLDER', label: 'Account Holder Name' },
      { key: 'WISE_ACCOUNT_NUMBER', label: 'Account Number' },
      { key: 'WISE_BANK_CODE', label: 'Bank Code / SWIFT' },
      { key: 'WISE_CURRENCY', label: 'Currency' },
    ],
  };
}

export async function createCheckout({ name, amountCents, currency }) {
  if (!ACCOUNT_NUMBER) throw new Error('Wise 收款账户未配置');
  const ref = `RANK-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  return {
    mode: 'manual',
    providerRef: ref,
    instructions: {
      holder: ACCOUNT_HOLDER,
      accountNumber: ACCOUNT_NUMBER,
      bankCode: BANK_CODE,
      currency: (currency || CURRENCY).toUpperCase(),
      amount: (amountCents / 100).toFixed(2),
      reference: ref,
      note: `请通过 Wise/银行转账 ${(amountCents / 100).toFixed(2)} ${(currency || CURRENCY).toUpperCase()} 到上述账户，备注「${ref}」，完成后在页面提交参考号。`,
    },
    raw: { ref },
  };
}

export async function verifyOrder(providerRef) {
  // 生产环境可调用 Wise API 查询 profile 下近期入金；这里需人工确认
  return { paid: false, raw: { reason: '需后台核对银行到账' } };
}

export async function verifyWebhook(rawBody) {
  return JSON.parse(rawBody);
}
