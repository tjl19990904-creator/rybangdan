# 🏆 付费排名展示网站

实时付费排名榜单：用户支付金额越高排名越靠前，榜单随支付实时更新；支持 **12 种支付方式**（Stripe、PayPal、Airwallex、USDT/加密货币、Wise、Payoneer、Cash App、支付宝、微信支付、银行卡、其他），后台可管理支付记录、审核手动支付、登记提款与查看财务统计。

## ✨ 功能一览

- **实时 Top 100 榜单**：前三名荣誉台 + 第 4-100 名完整列表，SSE 实时推送更新。
- **个人排名中心**：输入姓名即可查找“我的排名”，高亮显示当前用户及前后相邻名次。
- **多支付接入**：
  - **真实 REST API**：Stripe、PayPal、Airwallex（自动跳转 + Webhook 回调）。
  - **手动/加密货币流程**：USDT（提交 TxHash）、Wise、Payoneer、Cash App、支付宝、微信支付、银行卡、其他（提交参考号，后台确认后上榜）。
- **支付异常处理**：API 失败自动回退演示模式；Webhook 验签 + 5 分钟重放保护；成功页二次确认。
- **后台管理**：财务统计、支付记录（按状态/方式筛选）、手动确认支付、编辑/删除、榜单聚合、提款管理。
- **安全可靠**：后台 HttpOnly 签名令牌鉴权；SQLite WAL 持久化。
- **响应式设计**：适配桌面与移动端。

## 🚀 快速开始

> 要求 Node.js ≥ 22.5（内置 SQLite 支持）。

### 1. 演示模式（无需任何密钥，开箱即用）

```bash
cd paid-ranking
cp .env.example .env      # Windows: copy .env.example .env
npm start                 # 或 node server.js
```

未填写任何支付密钥时，所有支付方式默认进入演示模式：`DEMO_AUTO_PAY=true` 会直接上榜；设为 `false` 则显示该方式的收款说明，需后台确认。

打开：
- 榜单页：http://localhost:3000/
- 后台页：http://localhost:3000/admin.html （默认密码 `admin123`，**请修改**）

### 2. 启用真实支付

在 `.env` 中填写对应密钥并配置 Webhook：

| 方式 | 必填配置 | Webhook 端点 | 事件 |
|------|---------|-------------|------|
| Stripe | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | `/api/webhook/stripe` | `checkout.session.completed` |
| PayPal | `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID` | `/api/webhook/paypal` | `CHECKOUT.ORDER.APPROVED`, `CHECKOUT.ORDER.COMPLETED` |
| Airwallex | `AIRWALLEX_CLIENT_ID`, `AIRWALLEX_API_KEY` | `/api/webhook/airwallex` | `payment_intent.payment_success` |
| USDT | `USDT_ADDRESS` | — | 用户提交 TxHash，后台确认 |
| 支付宝/微信/银行卡等 | 对应收款账号 | — | 用户按说明转账，后台确认 |

## ⚙️ 配置项说明

详见 `.env.example`。关键项：

- `CURRENCY` / `CURRENCY_SYMBOL`：货币代码与符号。
- `MIN_AMOUNT`：最低上榜金额（主单位）。
- `DEMO_AUTO_PAY`：未配置密钥时是否自动直接上榜。
- `ADMIN_PASSWORD`：后台密码。
- `PUBLIC_BASE_URL`：公网地址（支付回调用）。

## 🏗️ 技术架构

```
paid-ranking/
├── server.js                  # HTTP 服务 + 路由 + SSE
├── lib/
│   ├── db.js                  # SQLite 数据层
│   ├── auth.js                # 管理员签名令牌
│   └── providers/
│       ├── index.js           # Provider 注册中心
│       ├── stripe.js          # Stripe Checkout
│       ├── paypal.js          # PayPal Orders v2
│       ├── airwallex.js       # Airwallex Payment Intent
│       ├── usdt.js            # 加密货币手动流程
│       ├── wise.js            # 银行转账
│       ├── payoneer.js        # Payoneer 手动
│       ├── cashapp.js         # Cash App 手动
│       ├── alipay.js          # 支付宝手动/回调桩
│       ├── wechat.js          # 微信支付手动/回调桩
│       ├── bankcard.js        # 银行卡手动
│       └── other.js           # 其他手动
├── public/
│   ├── index.html / app.js    # 榜单页（Top 100 + 我的排名）
│   ├── success.html           # 支付成功页
│   ├── admin.html / admin.js  # 后台管理
│   └── styles.css
├── .env.example
└── README.md
```

**零依赖**：仅使用 Node.js 内置模块（`http` / `node:sqlite` / `crypto` / `fetch`），无需 `npm install`。

## 💡 关于国内支付（支付宝 / 微信支付）

支付宝与微信支付的真实自动回调需要：
1. 国内/海外商户资质与正式商户号；
2. 官方 SDK 进行签名与验签；
3. 公网 HTTPS 域名与备案（国内）。

当前已实现：
- 前端选择支付宝/微信后展示收款说明与参考号；
- 用户提交参考号/流水号；
- 后台一键「确认支付」上榜；
- Webhook 路由 `/api/webhook/alipay`、`/api/webhook/wechat` 已预留，接入 SDK 后可直接启用自动回调。

## 🔒 安全须知

- 上线前修改 `ADMIN_PASSWORD`，并使用 HTTPS。
- Webhook 均含签名验证或事件二次查询。
- SQLite 启用 WAL 模式，适合中小规模并发。

## 📜 License

MIT
