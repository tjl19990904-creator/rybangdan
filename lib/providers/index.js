// lib/providers/index.js — 支付方式 Provider 注册中心

// 真实 API 接入
import * as stripe from './stripe.js';
import * as paypal from './paypal.js';
import * as airwallex from './airwallex.js';

// 手动/加密货币/国内/其他
import * as usdt from './usdt.js';
import * as wise from './wise.js';
import * as payoneer from './payoneer.js';
import * as cashapp from './cashapp.js';
import * as alipay from './alipay.js';
import * as wechat from './wechat.js';
import * as bankcard from './bankcard.js';
import * as other from './other.js';

// 数据库：动态加载自定义 provider
import { listCustomProviders } from '../db.js';

const registry = { stripe, paypal, airwallex, usdt, wise, payoneer, cashapp, alipay, wechat, bankcard, other };

// 动态生成的自定义 provider 模块缓存
const customModules = new Map();

// 根据数据库记录构建一个自定义 provider 模块
function buildCustomModule(record) {
  return {
    id: record.provider_id,
    getConfig() {
      return {
        id: record.provider_id,
        label: record.label,
        mode: record.mode || 'manual',
        enabled: record.enabled !== 0,
        demoFallback: false,
        needKeys: [],
        envReady: true, // 自定义 provider 始终视为"就绪"，使用 manual 逻辑
        configFields: [],
        isCustom: true,
        customId: record.id,
      };
    },
    async createCheckout({ name, amountCents, currency }) {
      const ref = `CUSTOM-${record.provider_id.toUpperCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
      const ins = record.instructions || {};
      return {
        mode: record.mode || 'manual',
        providerRef: ref,
        instructions: {
          reference: ref,
          amount: (amountCents / 100).toFixed(2),
          currency: (currency || 'usd').toUpperCase(),
          ...ins, // 展开自定义说明字段（address, account, holder, bankName, note, qrUrl, network, etc.）
        },
        raw: { ref, customProviderId: record.id },
      };
    },
    async verifyOrder() {
      return { paid: false, raw: { reason: '自定义支付方式，需后台手动确认' } };
    },
    async verifyWebhook(rawBody) {
      return JSON.parse(rawBody);
    },
  };
}

// 从数据库加载所有启用的自定义 provider 并注册
let _customLoaded = false;
export function reloadCustomProviders() {
  try {
    const list = listCustomProviders({ includeDisabled: false });
    // 先清除旧的自定义模块
    for (const [pid] of customModules) {
      delete registry[pid];
    }
    customModules.clear();
    // 注册新的自定义模块
    for (const rec of list) {
      const mod = buildCustomModule(rec);
      registry[rec.provider_id] = mod;
      customModules.set(rec.provider_id, mod);
    }
    _customLoaded = true;
    return list.length;
  } catch (e) {
    console.error('[providers] 加载自定义支付通道失败:', e.message);
    return 0;
  }
}

// 确保自定义 provider 已加载（首次调用时延迟加载）
function ensureCustomLoaded() {
  if (!_customLoaded) reloadCustomProviders();
}

export function getProvider(id) {
  ensureCustomLoaded();
  return registry[id] || null;
}

// 详细配置信息（含是否已配置真实密钥、所需密钥列表、Webhook 端点）
export function providerConfigDetail() {
  ensureCustomLoaded();
  return Object.entries(registry).map(([id, m]) => {
    const cfg = m.getConfig ? m.getConfig() : {};
    return {
      id,
      label: cfg.label || id,
      mode: cfg.mode || 'redirect', // redirect | manual | crypto | bank
      enabled: cfg.enabled !== false,
      envReady: cfg.envReady !== false,
      demoFallback: cfg.demoFallback !== false,
      needKeys: cfg.needKeys || [],
      webhookPath: `/api/webhook/${id}`,
      configFields: cfg.configFields || [],
      fieldStatus: Object.fromEntries((cfg.configFields || []).map(f => [f.key, Boolean(process.env[f.key])])),
      isCustom: cfg.isCustom || false,
      customId: cfg.customId || null,
    };
  });
}

export function listProviders() {
  return providerConfigDetail();
}

export function enabledProviders() {
  return listProviders().filter(p => p.enabled);
}

export function providerNames() {
  return enabledProviders().map(p => ({ id: p.id, label: p.label, mode: p.mode }));
}

// 动态读取某 Provider 当前生效的配置值（脱敏：密钥类只返回是否已设置，不返回明文）
export function getProviderStatus(id) {
  const m = getProvider(id);
  if (!m) return null;
  const cfg = m.getConfig ? m.getConfig() : {};
  const fields = cfg.configFields || [];
  const status = fields.map(f => ({ key: f.key, label: f.label, set: Boolean(process.env[f.key]), mask: true }));
  return {
    id,
    label: cfg.label || id,
    mode: cfg.mode || 'redirect',
    envReady: cfg.envReady !== false,
    webhookPath: `/api/webhook/${id}`,
    fields: status,
    isCustom: cfg.isCustom || false,
    customId: cfg.customId || null,
  };
}
