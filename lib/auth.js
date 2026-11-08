// lib/auth.js — 后台管理员鉴权（签名令牌，零依赖）
import crypto from 'node:crypto';

const PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
// 会话签名密钥与登录密码解耦：单独固定后，日后修改密码不会把已登录的后台会话全部踢掉
const SECRET = process.env.ADMIN_SECRET || PASSWORD;

// 启动自检：把"后台反复掉登录 / 用了弱密码"这类配置问题直接暴露在日志里
if (process.env.NODE_ENV === 'production') {
  if (PASSWORD === 'admin123') console.warn('[auth] 警告：未设置 ADMIN_PASSWORD，当前使用默认弱密码');
  if (!process.env.ADMIN_SECRET) console.warn('[auth] 警告：未设置 ADMIN_SECRET，会话密钥由密码派生，修改密码会使所有后台登录失效');
}

export function verifyPassword(input) {
  const a = Buffer.from(String(input || ''));
  const b = Buffer.from(PASSWORD);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function createToken() {
  const nonce = crypto.randomBytes(16).toString('hex');
  const sig = crypto.createHmac('sha256', SECRET).update(nonce).digest('hex');
  return `${nonce}.${sig}`;
}

export function verifyToken(token) {
  if (!token || typeof token !== 'string') return false;
  const [nonce, sig] = token.split('.');
  if (!nonce || !sig) return false;
  const expected = crypto.createHmac('sha256', SECRET).update(nonce).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(sig);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
