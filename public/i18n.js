// i18n.js — 首页 / 支付成功页的英中双语文案层（零依赖、纯前端）
// 设计：字典按 key 扁平存放；静态文案用 data-i18n 标记批量替换；
// 动态渲染（榜单、弹窗、toast）由 app.js 调用 t(key, vars) 取词。
(function () {
  const DICT = {
    en: {
      'meta.title': 'Leaderboard · Paid Ranking',
      'meta.description': 'Live paid ranking leaderboard — pay to rank, boost your position',
      'doc.title': '{site} · Leaderboard',
      'header.tagline': 'Pay More · Rank Higher',
      'header.cta': 'Get on the Board',
      'lang.aria': 'Language',
      'lang.en': 'EN',
      'lang.zh': '简体中文',
      'lb.title': 'Live Leaderboard',
      'lb.entries': '{n} entries',
      'lb.live': 'Live',
      'lb.myRank': 'My Rank',
      'lb.rankUnit': 'rank',
      'find.placeholder': 'Enter your name to find your rank',
      'find.btn': 'Find',
      'find.clear': 'Clear',
      'empty.title': 'The Board Awaits',
      'empty.desc': 'Be the first to claim the top spot!',
      'empty.cta': 'Get on the Board',
      'footer': 'Powered by Paid Ranking · Secure Payments',
      'rank.payments': '{n} payments · total',
      'rank.first': 'First entry',
      'rank.you': 'You',
      'rank.boost': '↑ Boost',
      'modal.title': 'Pay to Rank',
      'modal.sub': 'Enter your name and complete payment to join the leaderboard. The higher your payment, the higher your rank.',
      'modal.name': 'Name',
      'modal.namePh': 'e.g. Acme Inc.',
      'modal.method': 'Payment Method',
      'modal.selectMethod': 'Select a payment method',
      'modal.amount': 'Amount',
      'modal.amountPh': 'Higher amount = higher rank',
      'modal.minAmount': 'Min {sym}{n}',
      'modal.refLabel': 'Transaction Hash / Reference',
      'modal.refLabelCrypto': 'Transaction Hash (TxHash)',
      'modal.refLabelCN': 'Transaction ID / Last 4 digits',
      'modal.refLabelDefault': 'Transaction Reference',
      'modal.refPh': 'Fill in after payment',
      'modal.refPhCrypto': 'e.g. 0xabc...',
      'modal.refPhCN': 'e.g. 2024...',
      'modal.note': 'Note',
      'modal.notePh': 'Optional: contact, time, etc.',
      'modal.submit': 'Confirm Payment',
      'modal.submitRef': 'Submit Reference',
      'modal.processing': 'Processing...',
      'modal.submitting': 'Submitting...',
      'modal.redirectHint': 'You will be redirected to a secure payment page.',
      'modal.manualHint': 'Complete payment per instructions and submit the reference. You will be ranked after admin confirmation.',
      'modal.needMethod': 'Please select a payment method',
      'modal.needAmount': 'Minimum amount is {sym}{n}',
      'modal.needRef': 'Please enter the transaction reference',
      'ins.amount': 'Amount',
      'ins.network': 'Network',
      'ins.address': 'Address',
      'ins.account': 'Account',
      'ins.holder': 'Holder',
      'ins.bank': 'Bank',
      'ins.cashtag': 'Cashtag',
      'ins.payeeEmail': 'Payee Email',
      'ins.qr': 'Open QR code',
      'ins.reference': 'Reference',
      'ins.copy': 'Copy',
      'toast.copied': 'Copied',
      'toast.refSubmitted': 'Reference submitted. You will be ranked after admin confirmation.',
      'toast.onBoard': '🎉 {name} is on the board!',
      'toast.movedUp': '🎉 {name} moved up {n} spots! Now ranked #{rank}',
      'toast.movedUp1': '🎉 {name} moved up 1 spot! Now ranked #{rank}',
      'toast.boosted': '🎉 {name} boosted the total! Still ranked #{rank}',
      'toast.atRank': '🎉 {name} is on the board at #{rank}',
      'success.metaTitle': 'Payment Successful · Paid Ranking',
      'success.title': 'Payment Successful!',
      'success.msg': 'Thank you for joining the board. Your ranking has been updated in real time.',
      'success.named': 'Thank you, {name}! You are on the board. Your ranking has been updated in real time.',
      'success.pending': 'Your payment is being confirmed. The leaderboard will update once payment is verified.',
      'success.submitted': 'Your payment has been submitted. The leaderboard will update shortly.',
      'success.back': 'Back to Leaderboard',
    },
    zh: {
      'meta.title': '排行榜 · 付费排名',
      'meta.description': '实时付费排行榜 — 付费上榜，提升名次',
      'doc.title': '{site} · 排行榜',
      'header.tagline': '付费越多 · 排名越高',
      'header.cta': '立即上榜',
      'lang.aria': '语言',
      'lang.en': 'EN',
      'lang.zh': '简体中文',
      'lb.title': '实时排行榜',
      'lb.entries': '共 {n} 位',
      'lb.live': '实时',
      'lb.myRank': '我的排名',
      'lb.rankUnit': '名',
      'find.placeholder': '输入姓名查询我的排名',
      'find.btn': '查询',
      'find.clear': '清除',
      'empty.title': '榜单虚位以待',
      'empty.desc': '成为第一个登顶的人！',
      'empty.cta': '立即上榜',
      'footer': '由 Paid Ranking 提供支持 · 安全支付',
      'rank.payments': '{n} 笔支付 · 累计',
      'rank.first': '首次上榜',
      'rank.you': '我',
      'rank.boost': '↑ 加码',
      'modal.title': '付费上榜',
      'modal.sub': '填写姓名并完成支付即可加入排行榜，支付金额越高，排名越靠前。',
      'modal.name': '姓名',
      'modal.namePh': '例如：某某公司',
      'modal.method': '支付方式',
      'modal.selectMethod': '请选择支付方式',
      'modal.amount': '金额',
      'modal.amountPh': '金额越高，排名越靠前',
      'modal.minAmount': '最低 {sym}{n}',
      'modal.refLabel': '交易哈希 / 参考号',
      'modal.refLabelCrypto': '交易哈希 (TxHash)',
      'modal.refLabelCN': '交易号 / 后四位',
      'modal.refLabelDefault': '交易参考号',
      'modal.refPh': '付款后填写',
      'modal.refPhCrypto': '例如：0xabc...',
      'modal.refPhCN': '例如：2024...',
      'modal.note': '备注',
      'modal.notePh': '选填：联系方式、时间等',
      'modal.submit': '确认支付',
      'modal.submitRef': '提交凭证',
      'modal.processing': '处理中…',
      'modal.submitting': '提交中…',
      'modal.redirectHint': '将跳转到安全支付页面。',
      'modal.manualHint': '按说明完成付款并提交凭证，管理员确认后即可上榜。',
      'modal.needMethod': '请选择支付方式',
      'modal.needAmount': '最低金额为 {sym}{n}',
      'modal.needRef': '请填写交易参考号',
      'ins.amount': '金额',
      'ins.network': '网络',
      'ins.address': '地址',
      'ins.account': '账号',
      'ins.holder': '户名',
      'ins.bank': '银行',
      'ins.cashtag': 'Cashtag',
      'ins.payeeEmail': '收款邮箱',
      'ins.qr': '打开二维码',
      'ins.reference': '参考号',
      'ins.copy': '复制',
      'toast.copied': '已复制',
      'toast.refSubmitted': '凭证已提交，管理员确认后即可上榜。',
      'toast.onBoard': '🎉 {name} 已上榜！',
      'toast.movedUp': '🎉 {name} 上升 {n} 位！当前第 {rank} 名',
      'toast.movedUp1': '🎉 {name} 上升 1 位！当前第 {rank} 名',
      'toast.boosted': '🎉 {name} 累计金额已提升！仍为第 {rank} 名',
      'toast.atRank': '🎉 {name} 已上榜，当前第 {rank} 名',
      'success.metaTitle': '支付成功 · 付费排名',
      'success.title': '支付成功！',
      'success.msg': '感谢加入榜单，您的排名已实时更新。',
      'success.named': '感谢 {name}！您已上榜，排名已实时更新。',
      'success.pending': '支付正在确认中，核实后榜单会自动更新。',
      'success.submitted': '支付已提交，榜单稍后更新。',
      'success.back': '返回排行榜',
    },
  };

  const KEY = 'siteLang';
  let current = 'en';

  function detect() {
    const fromUrl = new URLSearchParams(location.search).get('lang');
    if (fromUrl === 'zh' || fromUrl === 'en') return fromUrl;
    try {
      const saved = localStorage.getItem(KEY);
      if (saved === 'zh' || saved === 'en') return saved;
    } catch (_) {}
    return 'en'; // 默认英文，沿用榜单页原有默认语言
  }

  function t(key, vars) {
    const str = (DICT[current] && DICT[current][key]) || DICT.en[key] || key;
    if (!vars) return str;
    return str.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  }

  function applyI18n() {
    const root = document.documentElement;
    root.lang = current === 'zh' ? 'zh-CN' : 'en';
    root.dataset.lang = current;

    document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => { el.placeholder = t(el.dataset.i18nPlaceholder); });
    document.querySelectorAll('[data-i18n-title]').forEach(el => { el.title = t(el.dataset.i18nTitle); });

    document.querySelectorAll('.lang-switch').forEach(box => { box.setAttribute('aria-label', t('lang.aria')); });
    document.querySelectorAll('.lang-switch button[data-lang]').forEach(btn => {
      const active = btn.dataset.lang === current;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });

    const desc = document.querySelector('meta[name="description"]');
    if (desc) desc.content = t('meta.description');
    document.title = t(document.body?.dataset.titleKey || 'meta.title');
  }

  function setLang(lang) {
    if (lang !== 'en' && lang !== 'zh') return;
    current = lang;
    try { localStorage.setItem(KEY, lang); } catch (_) {}
    const url = new URL(location.href);
    url.searchParams.set('lang', lang);
    history.replaceState(null, '', url.toString());
    applyI18n();
    window.dispatchEvent(new CustomEvent('langchange', { detail: { lang } }));
  }

  window.t = t;
  window.getLang = () => current;
  window.setLang = setLang;
  window.applyI18n = applyI18n;

  // 尽早写入 html[lang]，减少首屏语言闪烁
  current = detect();
  document.documentElement.lang = current === 'zh' ? 'zh-CN' : 'en';
  document.documentElement.dataset.lang = current;

  document.addEventListener('DOMContentLoaded', () => {
    applyI18n();
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('.lang-switch button[data-lang]');
      if (btn) setLang(btn.dataset.lang);
    });
  });
})();
