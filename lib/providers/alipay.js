// lib/providers/alipay.js — 支付宝（国内/国际）收款：通常需商户平台，未配置时走手动流程
const ALIPAY_ACCOUNT = process.env.ALIPAY_ACCOUNT || '';
const ALIPAY_QR_URL = process.env.ALIPAY_QR_URL || '';

export const id = 'alipay';
export function getConfig() {
  return {
    id, label: 'Alipay', mode: 'manual', enabled: true, demoFallback: true,
    needKeys: ['ALIPAY_ACCOUNT'],
    envReady: Boolean(ALIPAY_ACCOUNT),
    configFields: [
      { key: 'ALIPAY_ACCOUNT', label: 'Receiving Account' },
      { key: 'ALIPAY_QR_URL', label: 'QR Code URL (optional)' },
    ],
  };
}

export async function createCheckout({ name, amountCents, currency }) {
  if (!ALIPAY_ACCOUNT) throw new Error('支付宝收款账号未配置');
  const ref = `RANK-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  return {
    mode: 'manual',
    providerRef: ref,
    instructions: {
      account: ALIPAY_ACCOUNT,
      qrUrl: ALIPAY_QR_URL || null,
      amount: (amountCents / 100).toFixed(2),
      currency: currency.toUpperCase(),
      reference: ref,
      note: `请使用支付宝向 ${ALIPAY_ACCOUNT} 转账 ¥${(amountCents / 100).toFixed(2)}，备注「${ref}」，完成后提交流水号。`,
    },
    raw: { ref },
  };
}

export async function verifyOrder(providerRef) {
  return { paid: false, raw: { reason: '需后台核对支付宝到账' } };
}

export async function verifyWebhook(rawBody) {
  // 支付宝异步通知需验签（RSA），生产环境接入官方 SDK
  return JSON.parse(rawBody);
}
