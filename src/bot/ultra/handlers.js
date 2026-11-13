'use strict';

/**
 * ULTRA — מסכים וזרימות חדשים (תוספת בלבד, לא מחליף שום handler קיים):
 *   • מרכז הבית (/hub) עם ברכה לפי שעה, נתוני שוק חיים וטיפ יומי
 *   • כלים חכמים: יועץ מחירים, ציון איכות למודעה, מדריך וטיפים
 *   • חיפוש חכם בטקסט חופשי + חלופות כשאין תוצאות
 *   • אדמין: בדיקת תקינות מערכת וסיכום יומי
 */

const env = require('../../config/env');
const db = require('../../db/supabase');
const extra = require('../../db/extra');
const i18n = require('../../i18n');
const taxonomy = require('../../i18n/taxonomy');
const { ut } = require('../../i18n/ultra');
const kb = require('../keyboards');
const fmt = require('../formatters');
const brain = require('./brain');
const theme = require('./theme');
const ukb = require('./keyboards');

/* --------------------------------- עזרים --------------------------------- */

function langOf(ctx) {
  return i18n.normalize(ctx.lang) || i18n.DEFAULT_LANG;
}

function isPrivate(ctx) {
  return Boolean(ctx.chat && ctx.chat.type === 'private');
}

function isAdminCtx(ctx) {
  return Boolean(ctx.from && env.isAdmin(ctx.from.id));
}

/** עוטף handler כך ששגיאה לא תפיל את העדכון ולא תשאיר כפתור "תקוע". */
function guarded(name, handler) {
  return async (ctx, next) => {
    try {
      return await handler(ctx, next);
    } catch (error) {
      console.warn(`[ultra:${name}] ${error.message}`);
      try {
        if (ctx.callbackQuery) await ctx.answerCbQuery('⚠️');
      } catch (ignored) {
        /* noop */
      }
      return undefined;
    }
  };
}

async function answer(ctx, text) {
  if (!ctx.callbackQuery) return;
  try {
    await ctx.answerCbQuery(text);
  } catch (error) {
    /* ה-callback ישן מדי — לא קריטי */
  }
}

/** עריכת ההודעה הנוכחית (אם אפשר), אחרת שליחת הודעה חדשה. */
async function render(ctx, text, keyboard, { edit = true } = {}) {
  const options = { parse_mode: 'HTML', disable_web_page_preview: true, ...keyboard };
  if (edit && ctx.callbackQuery) {
    try {
      return await ctx.editMessageText(text, options);
    } catch (error) {
      /* הודעת מדיה / אותו תוכן — נשלח הודעה חדשה */
    }
  }
  return ctx.reply(text, options);
}

async function safeDelete(ctx) {
  try {
    await ctx.deleteMessage();
  } catch (error) {
    /* noop */
  }
}

/* ------------------------- מטמון קצר לנתונים כבדים ------------------------- */

const cache = new Map();

async function cached(key, ttlMs, loader) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  const value = await loader();
  cache.set(key, { at: Date.now(), value });
  return value;
}

const getCategories = () => cached('categories', 5 * 60 * 1000, () => db.listCategories());

async function marketStats() {
  return cached('market', 60 * 1000, async () => {
    const [active, today] = await Promise.all([
      db.countRows('listings', { status: 'approved' }).catch(() => 0),
      extra.countSince('listings', 'created_at', 1).catch(() => 0),
    ]);
    return { active, today };
  });
}

/* ------------------------------- מרכז הבית ------------------------------- */

function hubText(lang, name, market, mine) {
  const lines = [
    theme.scene('hub'),
    theme.greeting(lang, name),
    theme.DIVIDER,
    ut(lang, 'hub.market', { active: theme.num(market.active), today: theme.num(market.today) }),
  ];
  if (mine) {
    lines.push(ut(lang, 'hub.you', { mine: mine.ads, favs: mine.favs, alerts: mine.alerts }));
  }
  lines.push(theme.SOFT_DIVIDER, `${ut(lang, 'hub.tip')}: ${theme.tip(lang)}`, '', ut(lang, 'hub.pick'));
  return lines.join('\n');
}

async function renderHub(ctx, { edit = false } = {}) {
  const lang = langOf(ctx);
  const user = ctx.state && ctx.state.dbUser;
  const name = theme.esc((ctx.from && ctx.from.first_name) || '');

  const [market, mine] = await Promise.all([
    marketStats().catch(() => ({ active: 0, today: 0 })),
    user
      ? Promise.all([
          db.countRows('listings', { user_id: user.id, status: 'approved' }).catch(() => 0),
          db.countRows('favorites', { user_id: user.id }).catch(() => 0),
          extra.listSavedSearches(user.id).then((rows) => rows.length).catch(() => 0),
        ]).then(([ads, favs, alerts]) => ({ ads, favs, alerts }))
      : Promise.resolve(null),
  ]);

  return render(ctx, hubText(lang, name, market, mine), ukb.hub(lang), { edit });
}

/* ------------------------------- כלים חכמים ------------------------------- */

async function showTools(ctx, { edit = true } = {}) {
  const lang = langOf(ctx);
  const text = theme.frame('tools', ut(lang, 'tools.title'), [ut(lang, 'tools.body')]);
  return render(ctx, text, ukb.tools(lang), { edit });
}

async function showPriceCategories(ctx) {
  const lang = langOf(ctx);
  const categories = await getCategories();
  const text = theme.frame('price', ut(lang, 'price.title'), [ut(lang, 'price.pick')]);
  return render(ctx, text, ukb.priceCategories(categories, lang));
}

async function showPriceResult(ctx, categoryId) {
  const lang = langOf(ctx);
  const code = i18n.normalize(lang) || i18n.DEFAULT_LANG;
  const category = await db.getCategory(categoryId);
  if (!category) return answer(ctx, '⚠️');

  const stats = await brain.categoryPriceStats(categoryId);
  const lines = [`${category.emoji} <b>${theme.esc(category.name_he)}</b>`, ''];

  if (!stats) {
    lines.push(ut(lang, 'price.none'));
  } else {
    lines.push(
      ut(lang, 'price.stats', { count: stats.count, median: theme.num(stats.median), avg: theme.num(stats.average) }),
      ut(lang, 'price.range', { low: theme.num(stats.low), high: theme.num(stats.high) })
    );
    const conditions = Object.entries(stats.byCondition);
    if (conditions.length) {
      lines.push('', ut(lang, 'price.byCond'));
      conditions.forEach(([condition, median]) => {
        lines.push(`• ${theme.esc(taxonomy.conditionLabel(condition, code))}: <b>₪${theme.num(median)}</b>`);
      });
    }
    lines.push('', ut(lang, 'price.advice'));
  }

  return render(ctx, theme.frame('price', ut(lang, 'price.title'), lines), ukb.priceResult(lang));
}

async function showScoreList(ctx) {
  const lang = langOf(ctx);
  const user = ctx.state && ctx.state.dbUser;
  if (!user) return answer(ctx, '⚠️');

  const { items } = await db.listUserListings(user.id, 0, 8, ['approved', 'pending']);
  if (!items.length) {
    return render(ctx, theme.frame('score', ut(lang, 'score.title'), [ut(lang, 'score.none')]), ukb.tools(lang));
  }
  const text = theme.frame('score', ut(lang, 'score.title'), [ut(lang, 'score.pick')]);
  return render(ctx, text, ukb.scoreList(items, lang));
}

async function showScoreDetail(ctx, listingId) {
  const lang = langOf(ctx);
  const user = ctx.state && ctx.state.dbUser;
  const listing = await db.getListing(listingId);

  if (!listing || !user || listing.user_id !== user.id) {
    return answer(ctx, ut(lang, 'score.none'));
  }

  const market = listing.category_id ? await brain.categoryPriceStats(listing.category_id) : null;
  const result = brain.scoreListing(listing, market);

  const lines = [
    `🛍️ <b>${theme.esc(listing.title)}</b>`,
    '',
    `${theme.scoreEmoji(result.score)} ${theme.meter(result.score, 100, 10)} ${ut(lang, 'score.total', { score: result.score })}`,
    ut(lang, theme.scoreLevelKey(result.score)),
    theme.SOFT_DIVIDER,
  ];

  result.details.forEach((detail) => {
    const mark = detail.ok ? '✅' : detail.ratio > 0 ? '🟡' : '⚠️';
    lines.push(`${mark} ${ut(lang, `score.c.${detail.id}`)} · ${detail.points}/${detail.weight}`);
    if (!detail.ok) {
      const suffix = detail.id === 'market' && market ? ` (₪${theme.num(market.low)}–₪${theme.num(market.high)})` : '';
      lines.push(`   ↳ ${ut(lang, `score.t.${detail.id}`)}${suffix}`);
    }
  });

  return render(ctx, theme.frame('score', ut(lang, 'score.title'), lines), ukb.scoreDetail(listing, lang));
}

async function showSafety(ctx) {
  const lang = langOf(ctx);
  const lines = [1, 2, 3, 4].map((n) => ut(lang, `guide.safe${n}`));
  const text = theme.frame('safety', ut(lang, 'guide.safeTitle'), lines);
  return render(ctx, text, ukb.tools(lang));
}

async function showGuide(ctx, { edit = true } = {}) {
  const lang = langOf(ctx);
  const steps = [1, 2, 3, 4].map((n) => ut(lang, `guide.s${n}`));
  const safe = [1, 2, 3, 4].map((n) => ut(lang, `guide.safe${n}`));
  const text = [
    theme.scene('guide'),
    ut(lang, 'guide.title'),
    theme.DIVIDER,
    ...steps,
    '',
    ut(lang, 'guide.safeTitle'),
    theme.SOFT_DIVIDER,
    ...safe,
  ].join('\n');
  return render(ctx, text, ukb.guideKeyboard(lang), { edit });
}

async function showTip(ctx, index, { edit = true } = {}) {
  const lang = langOf(ctx);
  const current = theme.tipIndex(Number.isInteger(index) && index > 0 ? index - 1 : undefined);
  const text = theme.frame('tips', ut(lang, 'tips.title'), [theme.tip(lang, current)]);
  return render(ctx, text, ukb.tipKeyboard(lang, current + 2), { edit });
}

/* ---------------------------- חיפוש חכם בטקסט חופשי ---------------------------- */

function isMenuLabel(text) {
  const legacy = [kb.CANCEL, kb.SKIP, kb.DONE_PHOTOS, kb.SHARE_PHONE, ...Object.values(kb.MENU || {})].filter(Boolean);
  if (legacy.includes(text)) return true;
  try {
    const pro = require('../pro');
    return pro.MENU_INDEX.has(text) || pro.CANCEL_LABELS.has(text);
  } catch (error) {
    return false;
  }
}

function filtersLine(filters, lang) {
  const code = i18n.normalize(lang) || i18n.DEFAULT_LANG;
  const parts = [];
  if (filters.q) parts.push(`🔤 <b>${theme.esc(filters.q)}</b>`);
  if (filters.freeOnly) parts.push('🎁 0₪');
  if (Number.isFinite(filters.minPrice) || Number.isFinite(filters.maxPrice)) {
    const min = Number.isFinite(filters.minPrice) ? filters.minPrice : 0;
    const max = Number.isFinite(filters.maxPrice) ? `₪${theme.num(filters.maxPrice)}` : '∞';
    parts.push(`💰 ₪${theme.num(min)} – ${max}`);
  }
  if (filters.location) parts.push(`📍 ${theme.esc(taxonomy.regionLabel(filters.location, code))}`);
  return parts.join(' · ');
}

const RELAX_CODES = { 'smart.noPrice': 'price', 'smart.noRegion': 'region', 'smart.noCat': 'cat' };

async function smartText(ctx, next) {
  const text = (ctx.message && ctx.message.text ? ctx.message.text : '').trim();

  // לא נוגעים בשום זרימה פעילה / פקודה / תפריט / קבוצה — רק טקסט חופשי בפרטי.
  if (!text || text.length < 2 || text.startsWith('/')) return next();
  if (!isPrivate(ctx) || !ctx.session || ctx.session.state) return next();
  if (!ctx.state || !ctx.state.dbUser) return next();
  if (isMenuLabel(text)) return next();

  const lang = langOf(ctx);
  const parsed = brain.parseQuery(text);
  const structured = parsed.signals.length > 0;
  const filters = brain.toFilters(parsed, { regionValues: kb.REGIONS });

  // בלי סימנים מובנים — שומרים את הטקסט המקורי (כמו ההתנהגות הקיימת).
  if (!structured) filters.q = text;
  if (!filters.q && !structured) return next();

  const { total } = await db.searchListings(filters, 0, 1);

  ctx.session.search = filters;
  ctx.session.ultra = { ...(ctx.session.ultra || {}), lastText: text };

  if (total > 0) {
    const userHandlers = require('../handlers/user');
    if (structured) {
      await ctx.reply(`${ut(lang, 'smart.understood')}\n${filtersLine(filters, lang)}`, { parse_mode: 'HTML' });
    } else {
      await ctx.reply(`🔍 <b>${fmt.esc(text)}</b>...`, { parse_mode: 'HTML' });
    }
    return userHandlers.showResult(ctx, 0);
  }

  // אין תוצאות — מציעים חלופות שמחזירות תוצאות.
  const categories = await getCategories().catch(() => []);
  const category = brain.categoryFromText(text, categories);
  const options = (await brain.relaxations(filters)).map((option) => ({ ...option, code: RELAX_CODES[option.key] }));

  const lines = [
    theme.scene('empty'),
    ut(lang, 'smart.none'),
    theme.DIVIDER,
    filtersLine(filters, lang),
    '',
    ut(lang, 'smart.noneBody'),
  ];
  return ctx.reply(lines.join('\n'), {
    parse_mode: 'HTML',
    ...ukb.emptyResult(lang, { options, category, canAlert: true }),
  });
}

async function relaxSearch(ctx, code) {
  const filters = { ...((ctx.session && ctx.session.search) || {}) };
  if (code === 'price') {
    delete filters.minPrice;
    delete filters.maxPrice;
  } else if (code === 'region') {
    delete filters.location;
  } else if (code === 'cat') {
    delete filters.categoryId;
    delete filters.categoryName;
  }
  ctx.session.search = filters;

  await answer(ctx, '🔍');
  await safeDelete(ctx);
  const userHandlers = require('../handlers/user');
  return userHandlers.showResult(ctx, 0);
}

/* --------------------------------- אדמין --------------------------------- */

async function adminGuard(ctx) {
  if (isAdminCtx(ctx)) return true;
  const lang = langOf(ctx);
  const message = i18n.t(lang, 'common.noPermission');
  if (ctx.callbackQuery) await answer(ctx, message);
  else await ctx.reply(message);
  return false;
}

function mark(ok) {
  if (ok === 'warn') return '⚠️';
  return ok ? '✅' : '❌';
}

async function checkChat(ctx, chatId, { needPost }) {
  try {
    const botId = (ctx.botInfo && ctx.botInfo.id) || (await ctx.telegram.getMe()).id;
    const [chat, member] = await Promise.all([ctx.telegram.getChat(chatId), ctx.telegram.getChatMember(chatId, botId)]);
    const isAdmin = member.status === 'administrator' || member.status === 'creator';
    const label = chat.title || (chat.username ? `@${chat.username}` : String(chatId));

    if (needPost) {
      const canPost = member.status === 'creator' || (isAdmin && member.can_post_messages !== false);
      if (!canPost) return { ok: false, text: `${theme.esc(label)} — bot cannot post (grant "Post/Edit/Delete messages")` };
      return { ok: true, text: `${theme.esc(label)} — bot is admin` };
    }
    return { ok: member.status !== 'left' && member.status !== 'kicked', text: `${theme.esc(label)} — ${member.status}` };
  } catch (error) {
    return { ok: false, text: `${theme.esc(String(chatId))} — ${theme.esc(error.message)}` };
  }
}

async function tableExists(table) {
  try {
    const { error } = await db.supabase.from(table).select('*', { count: 'exact', head: true }).limit(1);
    return !error;
  } catch (error) {
    return false;
  }
}

async function showHealth(ctx, { edit = true } = {}) {
  const lang = langOf(ctx);
  const destinations = require('../../services/destinations');
  const lines = [theme.scene('health'), ut(lang, 'admin.healthTitle'), theme.DIVIDER];

  // מסד נתונים
  const startedAt = Date.now();
  let pending = 0;
  let approved = 0;
  let dbOk = true;
  try {
    [pending, approved] = await Promise.all([
      db.countRows('listings', { status: 'pending' }),
      db.countRows('listings', { status: 'approved' }),
    ]);
  } catch (error) {
    dbOk = false;
  }
  const dbMs = Date.now() - startedAt;
  lines.push(`${mark(dbOk ? (dbMs > 1500 ? 'warn' : true) : false)} Database — ${dbOk ? `${dbMs}ms` : 'unreachable (check SUPABASE_URL / service_role key)'}`);

  // מיגרציות
  const tables = ['app_settings', 'saved_searches', 'reports', 'blocked_words', 'events', 'bot_destinations'];
  const existence = await Promise.all(tables.map(tableExists));
  const missing = tables.filter((_, index) => !existence[index]);
  lines.push(
    missing.length
      ? `⚠️ Migrations — missing: ${missing.join(', ')} (run schema_v2.sql / schema_channels.sql)`
      : '✅ Migrations — all tables present'
  );

  // תור מודעות
  if (dbOk) {
    let queueLine = `✅ Queue — ${pending} pending · ${approved} live`;
    let queueMark = true;
    try {
      const oldest = (await db.listPendingListings(1))[0];
      if (oldest) {
        const hours = Math.round((Date.now() - new Date(oldest.created_at).getTime()) / 3600000);
        queueLine = `Queue — ${pending} pending (oldest ${hours}h) · ${approved} live`;
        queueMark = hours >= 24 ? 'warn' : true;
      }
    } catch (error) {
      /* noop */
    }
    lines.push(`${mark(queueMark)} ${queueLine.replace(/^✅ /, '')}`);
  }

  // ערוצים וקבוצות
  const [channelIds, groupIds] = await Promise.all([
    destinations.getChannelIds().catch(() => []),
    destinations.getAdminGroupIds().catch(() => []),
  ]);

  if (!channelIds.length) lines.push('❌ Channel — not configured (CHANNEL_ID)');
  for (const id of channelIds.slice(0, 5)) {
    const result = await checkChat(ctx, id, { needPost: true });
    lines.push(`${mark(result.ok)} Channel — ${result.text}`);
  }
  if (!groupIds.length) lines.push('❌ Admin group — not configured (ADMIN_GROUP_ID)');
  for (const id of groupIds.slice(0, 5)) {
    const result = await checkChat(ctx, id, { needPost: false });
    lines.push(`${mark(result.ok)} Admin group — ${result.text}`);
  }

  // הגדרות ומשתני סביבה
  let settings = {};
  try {
    settings = await extra.getSettings();
  } catch (error) {
    /* noop */
  }
  const maintenance = settings.maintenance_mode === true || settings.maintenance_mode === 'true';
  const autoApprove = settings.auto_approve === true || settings.auto_approve === 'true';
  lines.push(
    `${mark(maintenance ? 'warn' : true)} Maintenance — ${maintenance ? 'ON (publishing blocked)' : 'off'}`,
    `${mark(true)} Auto-approve — ${autoApprove ? 'ON' : 'off'}`
  );

  const envWarnings = [];
  if (!env.BOT_USERNAME) envWarnings.push('BOT_USERNAME');
  if (!env.CHANNEL_URL) envWarnings.push('CHANNEL_URL');
  if (!env.SUPPORT_USERNAME) envWarnings.push('SUPPORT_USERNAME');
  if (env.MODE === 'webhook' && !env.WEBHOOK_SECRET) envWarnings.push('WEBHOOK_SECRET');
  lines.push(
    envWarnings.length ? `⚠️ Env — optional/missing: ${envWarnings.join(', ')}` : '✅ Env — all recommended variables set'
  );

  // תהליך
  const rssMb = Math.round(process.memoryUsage().rss / 1048576);
  const uptimeH = Math.floor(process.uptime() / 3600);
  const uptimeM = Math.floor((process.uptime() % 3600) / 60);
  lines.push(
    theme.SOFT_DIVIDER,
    `🖥️ ${env.MODE || 'polling'} · Node ${process.version} · ${rssMb}MB · up ${uptimeH}h ${uptimeM}m`
  );

  return render(ctx, lines.join('\n'), ukb.adminHealth(lang), { edit });
}

async function showDigest(ctx, { edit = true } = {}) {
  const lang = langOf(ctx);
  const [users, listings, approved, sold, reports, pending, series] = await Promise.all([
    extra.countSince('users', 'created_at', 1),
    extra.countSince('listings', 'created_at', 1),
    extra.countSince('listings', 'approved_at', 1),
    extra.countSince('listings', 'sold_at', 1),
    db.countRows('reports', { status: 'open' }).catch(() => 0),
    db.countRows('listings', { status: 'pending' }).catch(() => 0),
    extra.dailySeries('listings', 'created_at', 7).catch(() => []),
  ]);

  const lines = [
    `👥 +${theme.num(users)} users`,
    `🆕 +${theme.num(listings)} listings · ✅ ${theme.num(approved)} approved · 🏷️ ${theme.num(sold)} sold`,
    `⏳ ${theme.num(pending)} waiting for approval · 🚩 ${theme.num(reports)} open reports`,
  ];
  if (series.length) lines.push('', `📈 7d listings  ${theme.spark(series)}`);
  lines.push('', `🕐 ${fmt.formatDateTime(new Date())}`);

  return render(ctx, theme.frame('digest', ut(lang, 'admin.digestTitle'), lines), ukb.adminDigest(lang), { edit });
}

/* --------------------------------- רישום --------------------------------- */

function register(bot) {
  /* ---------- פקודות ---------- */
  bot.command('hub', guarded('hub', (ctx) => (isPrivate(ctx) ? renderHub(ctx) : undefined)));
  bot.command('tools', guarded('tools', (ctx) => showTools(ctx, { edit: false })));
  bot.command('price', guarded('price', (ctx) => showPriceCategories(ctx)));
  bot.command('score', guarded('score', (ctx) => showScoreList(ctx)));
  bot.command('guide', guarded('guide', (ctx) => showGuide(ctx, { edit: false })));
  bot.command('tips', guarded('tips', (ctx) => showTip(ctx, 0, { edit: false })));

  bot.command('ultra', guarded('ultra', async (ctx) => {
    if (!(await adminGuard(ctx))) return undefined;
    return showHealth(ctx, { edit: false });
  }));

  /* ---------- משתמש ---------- */
  bot.action('u:hub', guarded('u:hub', async (ctx) => {
    await answer(ctx);
    return renderHub(ctx, { edit: true });
  }));

  bot.action('u:tools', guarded('u:tools', async (ctx) => {
    await answer(ctx);
    return showTools(ctx);
  }));

  bot.action('u:price', guarded('u:price', async (ctx) => {
    await answer(ctx);
    return showPriceCategories(ctx);
  }));

  bot.action(/^u:pc:(\d+)$/, guarded('u:pc', async (ctx) => {
    await answer(ctx);
    return showPriceResult(ctx, Number(ctx.match[1]));
  }));

  bot.action('u:score', guarded('u:score', async (ctx) => {
    await answer(ctx);
    return showScoreList(ctx);
  }));

  bot.action(/^u:sc:(\d+)$/, guarded('u:sc', async (ctx) => {
    await answer(ctx);
    return showScoreDetail(ctx, Number(ctx.match[1]));
  }));

  bot.action('u:safe', guarded('u:safe', async (ctx) => {
    await answer(ctx);
    return showSafety(ctx);
  }));

  bot.action('u:guide', guarded('u:guide', async (ctx) => {
    await answer(ctx);
    return showGuide(ctx);
  }));

  bot.action(/^u:tip:(\d+)$/, guarded('u:tip', async (ctx) => {
    await answer(ctx);
    return showTip(ctx, Number(ctx.match[1]));
  }));

  bot.action(/^u:alt:(price|region|cat)$/, guarded('u:alt', (ctx) => relaxSearch(ctx, ctx.match[1])));

  /* ---------- אדמין ---------- */
  bot.action('ux:health', guarded('ux:health', async (ctx) => {
    if (!(await adminGuard(ctx))) return undefined;
    await answer(ctx, '🩺');
    return showHealth(ctx);
  }));

  bot.action('ux:digest', guarded('ux:digest', async (ctx) => {
    if (!(await adminGuard(ctx))) return undefined;
    await answer(ctx, '📅');
    return showDigest(ctx);
  }));

  /* ---------- טקסט חופשי חכם — חייב להירשם לפני ראוטר הטקסט הכללי ---------- */
  bot.on('text', guarded('smartText', smartText));
}

module.exports = {
  register,
  renderHub,
  showTools,
  showHealth,
  showDigest,
  smartText,
  relaxSearch,
};
