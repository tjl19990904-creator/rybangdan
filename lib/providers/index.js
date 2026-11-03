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

const registry = { stripe, paypal, airwallex, usdt, wise, payoneer, cashapp, alipay, wechat, bankcard, other };

export function getProvider(id) { return registry[id] || null; }

// 详细配置信息（含是否已配置真实密钥、所需密钥列表、Webhook 端点）
export function providerConfigDetail() {
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
  };
}
