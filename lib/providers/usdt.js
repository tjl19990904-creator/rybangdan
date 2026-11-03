// lib/providers/usdt.js — USDT / 加密货币：链上支付 + 提交 txHash 人工/半自动审核
const ADDRESS = process.env.USDT_ADDRESS || '';
const NETWORK = process.env.USDT_NETWORK || 'TRC20'; // ERC20 / TRC20 / BEP20
const EXPLORER_API_KEY = process.env.USDT_EXPLORER_API_KEY || '';
const EXPLORER_BASE = process.env.USDT_EXPLORER_BASE || 'https://apilist.tronscanapi.com'; // 示例：TronScan

export const id = 'usdt';
export function getConfig() {
  return {
    id, label: 'USDT / Crypto', mode: 'crypto', enabled: true, demoFallback: true,
    needKeys: ['USDT_ADDRESS'],
    envReady: Boolean(ADDRESS),
    configFields: [
      { key: 'USDT_ADDRESS', label: 'Receiving Address' },
      { key: 'USDT_NETWORK', label: 'Network (ERC20/TRC20/BEP20)' },
      { key: 'USDT_EXPLORER_API_KEY', label: 'Explorer API Key (optional)' },
      { key: 'USDT_EXPLORER_BASE', label: 'Explorer API Base URL (optional)' },
    ],
  };
}

export async function createCheckout({ name, amountCents, currency }) {
  if (!ADDRESS) throw new Error('USDT_ADDRESS 未配置');
  const major = (amountCents / 100).toFixed(2);
  const ref = `RANK-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  return {
    mode: 'manual',
    providerRef: ref,
    instructions: {
      network: NETWORK,
      address: ADDRESS,
      amount: major,
      memo: ref,
      note: `请向该地址转账 ${major} USDT（${NETWORK}），并在转账备注中填写「${ref}」，完成后提交交易哈希（TxHash）。`,
    },
    raw: { ref },
  };
}

export async function verifyOrder(providerRef) {
  // 若配置了区块浏览器 API，可尝试查询最近交易（简化示例）
  if (!EXPLORER_API_KEY) return { paid: false, raw: { reason: '未配置区块浏览器 API，需后台人工确认' } };
  try {
    const res = await fetch(`${EXPLORER_BASE}/api/transaction?sort=-timestamp&limit=1&address=${ADDRESS}&api_key=${EXPLORER_API_KEY}`);
    const data = await res.json();
    return { paid: false, raw: data };
  } catch (e) {
    return { paid: false, raw: { error: e.message } };
  }
}

export async function verifyWebhook(rawBody) {
  // 加密货币无标准 Webhook；可由第三方服务（如 Chainify、Moralis）转发后解析
  return JSON.parse(rawBody);
}
