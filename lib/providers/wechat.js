// lib/providers/wechat.js — 微信支付：通常需国内商户号，未配置时走手动流程
const WXPAY_MCH_ID = process.env.WXPAY_MCH_ID || '';
const WXPAY_APP_ID = process.env.WXPAY_APP_ID || '';
const WXPAY_QR_URL = process.env.WXPAY_QR_URL || '';

export const id = 'wechat';
export function getConfig() {
  return {
    id, label: 'WeChat Pay', mode: 'manual', enabled: true, demoFallback: true,
    needKeys: ['WXPAY_MCH_ID'],
    envReady: Boolean(WXPAY_MCH_ID),
    configFields: [
      { key: 'WXPAY_MCH_ID', label: 'Merchant ID' },
      { key: 'WXPAY_APP_ID', label: 'App ID' },
      { key: 'WXPAY_QR_URL', label: 'QR Code URL (optional)' },
    ],
  };
}

export async function createCheckout({ name, amountCents, currency }) {
  if (!WXPAY_MCH_ID) throw new Error('微信支付商户号未配置');
  const ref = `RANK-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  return {
    mode: 'manual',
    providerRef: ref,
    instructions: {
      mchId: WXPAY_MCH_ID,
      appId: WXPAY_APP_ID || null,
      qrUrl: WXPAY_QR_URL || null,
      amount: (amountCents / 100).toFixed(2),
      currency: currency.toUpperCase(),
      reference: ref,
      note: `请使用微信扫码/转账 ${(amountCents / 100).toFixed(2)} ${currency.toUpperCase()}，备注「${ref}」，完成后提交流水号。`,
    },
    raw: { ref },
  };
}

export async function verifyOrder(providerRef) {
  return { paid: false, raw: { reason: '需后台核对微信到账' } };
}

export async function verifyWebhook(rawBody) {
  // 微信支付异步通知需验签（AES/RSA），生产环境接入官方 SDK
  return JSON.parse(rawBody);
}
