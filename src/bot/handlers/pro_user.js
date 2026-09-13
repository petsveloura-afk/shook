'use strict';

/**
 * ממשק המשתמש המורחב (PRO) — רב-לשוני, עשיר ומהיר.
 * נוסף על handlers/user.js הקיים ולא מחליף אותו.
 */

const env = require('../../config/env');
const db = require('../../db/supabase');
const extra = require('../../db/extra');
const i18n = require('../../i18n');
const kb = require('../keyboards');
const kbp = require('../keyboards_pro');
const fmt = require('../formatters');
const fmtPro = require('../formatters_pro');

const CAPTION_LIMIT = 1000;

/* --------------------------------- עזרים --------------------------------- */

function T(ctx) {
  return ctx.t || i18n.translator(i18n.DEFAULT_LANG);
}

function langOf(ctx) {
  return ctx.lang || i18n.DEFAULT_LANG;
}

async function safeDelete(ctx) {
  try {
    await ctx.deleteMessage();
  } catch (error) {
    /* ההודעה כבר נמחקה או ישנה מדי */
  }
}

async function sendCard(ctx, listing, text, keyboard) {
  const photos = listing.photos || [];
  const extraOptions = { parse_mode: 'HTML', reply_markup: keyboard.reply_markup, disable_web_page_preview: true };

  if (photos.length && text.length <= CAPTION_LIMIT) {
    return ctx.replyWithPhoto(photos[0], { caption: text, ...extraOptions });
  }
  if (photos.length) await ctx.replyWithPhoto(photos[0]);
  return ctx.reply(text, extraOptions);
}

async function userStats(userId) {
  const [active, pending, sold, rejected, favorites] = await Promise.all([
    db.countRows('listings', { user_id: userId, status: 'approved' }),
    db.countRows('listings', { user_id: userId, status: 'pending' }),
    db.countRows('listings', { user_id: userId, status: 'sold' }),
    db.countRows('listings', { user_id: userId, status: 'rejected' }),
    db.countRows('favorites', { user_id: userId }),
  ]);

  const rows = await extra.safe(
    () =>
      db.supabase
        .from('listings')
        .select('views_count, contacts_count')
        .eq('user_id', userId)
        .neq('status', 'deleted')
        .limit(2000),
    [],
    'userStats:views'
  );

  const views = rows.reduce((sum, row) => sum + Number(row.views_count || 0), 0);
  const contacts = rows.reduce((sum, row) => sum + Number(row.contacts_count || 0), 0);

  return { active, pending, sold, rejected, favorites, views, contacts };
}

/* ------------------------------ בית והגדרות ------------------------------ */

async function home(ctx) {
  const t = T(ctx);
  const lang = langOf(ctx);
  const name = fmt.esc(ctx.from.first_name || '');

  return ctx.reply(
    [t('welcome.title', { name }), '', t('welcome.body'), '', t('welcome.tip')].join('\n'),
    { parse_mode: 'HTML', ...kbp.mainMenu(lang) }
  );
}

async function showSettings(ctx, { edit = false } = {}) {
  const lang = langOf(ctx);
  const user = ctx.state.dbUser;
  const text = fmtPro.settingsCard(user, lang);
  const options = { parse_mode: 'HTML', ...kbp.settingsKeyboard(user, lang) };

  if (edit) {
    try {
      return await ctx.editMessageText(text, options);
    } catch (error) {
      /* נשלח הודעה חדשה */
    }
  }
  return ctx.reply(text, options);
}

async function showLanguages(ctx, { edit = true } = {}) {
  const lang = langOf(ctx);
  const t = T(ctx);
  const text = `${t('lang.title')}\n${fmtPro.DIVIDER}\n${t('lang.body')}\n\n${t('lang.current', {
    lang: i18n.localeName(lang),
  })}`;
  const options = { parse_mode: 'HTML', ...kbp.languageKeyboard(lang) };

  if (edit) {
    try {
      return await ctx.editMessageText(text, options);
    } catch (error) {
      /* נשלח הודעה חדשה */
    }
  }
  return ctx.reply(text, options);
}

/* --------------------------------- גלישה --------------------------------- */

async function showBrowse(ctx, { edit = false } = {}) {
  const lang = langOf(ctx);
  const t = T(ctx);
  const text = `${t('browse.title')}\n${fmtPro.DIVIDER}\n${t('common.select')}`;
  const options = { parse_mode: 'HTML', ...kbp.browseKeyboard(lang) };

  if (edit) {
    try {
      return await ctx.editMessageText(text, options);
    } catch (error) {
      /* נשלח הודעה חדשה */
    }
  }
  return ctx.reply(text, options);
}

async function showCategories(ctx) {
  const lang = langOf(ctx);
  const t = T(ctx);
  const [categories, counts] = await Promise.all([db.listCategories(), extra.categoryCounts()]);
  const text = `${t('browse.title')}\n${fmtPro.DIVIDER}\n${t('browse.pick')}`;

  try {
    return await ctx.editMessageText(text, {
      parse_mode: 'HTML',
      ...kbp.browseCategories(categories, counts, lang),
    });
  } catch (error) {
    return ctx.reply(text, { parse_mode: 'HTML', ...kbp.browseCategories(categories, counts, lang) });
  }
}

/** פענוח מקור הפיד: feed:<mode> | cat:<id> | reg:<index> */
function parseSource(source) {
  const [kind, value] = String(source).split(':');
  if (kind === 'cat') return { mode: 'newest', categoryId: Number(value) };
  if (kind === 'reg') return { mode: 'newest', location: kb.REGIONS[Number(value)] };
  return { mode: value || 'newest' };
}

async function showFeed(ctx, source, page = 0) {
  const lang = langOf(ctx);
  const t = T(ctx);
  const params = parseSource(source);

  const { items, total } = await extra.feed({ ...params, page, pageSize: 1 });

  if (!total || !items.length) {
    await ctx.reply(t('browse.empty'), { parse_mode: 'HTML' });
    return showBrowse(ctx);
  }

  const listing = items[0];
  await db.incrementViews(listing.id);
  const isFav = await db.isFavorite(ctx.state.dbUser.id, listing.id);

  const text = fmtPro.listingCard(listing, lang, { page, total });
  return sendCard(ctx, listing, text, kbp.feedCardKeyboard(listing, { page, total, isFav, lang, source }));
}

async function showSimilar(ctx, listingId) {
  const lang = langOf(ctx);
  const t = T(ctx);
  const listing = await db.getListing(listingId);
  if (!listing) return ctx.reply(t('common.notFound'));

  const similar = await extra.similarListings(listing, 3);
  if (!similar.length) return ctx.reply(`${t('similar.title')}\n\n${t('similar.none')}`, { parse_mode: 'HTML' });

  await ctx.reply(t('similar.title'), { parse_mode: 'HTML' });
  for (const item of similar) {
    const isFav = await db.isFavorite(ctx.state.dbUser.id, item.id);
    await sendCard(
      ctx,
      item,
      fmtPro.listingCard(item, lang, { showSeller: false }),
      kbp.feedCardKeyboard(item, { page: 0, total: 1, isFav, lang, source: `feed:newest` })
    );
  }
  return true;
}

async function showSellerProfile(ctx, sellerId, page = 0) {
  const lang = langOf(ctx);
  const t = T(ctx);
  const seller = await db.getUserById(sellerId);
  if (!seller) return ctx.reply(t('common.notFound'));

  const stats = await userStats(seller.id);
  const { items, total } = await extra.listingsBySeller(seller.id, page, 1);

  await ctx.reply(fmtPro.sellerProfile(seller, stats, lang), {
    parse_mode: 'HTML',
    ...kbp.sellerKeyboard(seller.id, lang, { page, total }),
  });

  if (items.length) {
    const listing = items[0];
    const isFav = await db.isFavorite(ctx.state.dbUser.id, listing.id);
    await sendCard(
      ctx,
      listing,
      fmtPro.listingCard(listing, lang, { page, total, showSeller: false }),
      kbp.feedCardKeyboard(listing, { page, total, isFav, lang, source: `sel:${seller.id}` })
    );
  }
  return true;
}

/* ------------------------------- לוח אישי ------------------------------- */

async function showDashboard(ctx) {
  const lang = langOf(ctx);
  const user = ctx.state.dbUser;
  const stats = await userStats(user.id);
  return ctx.reply(fmtPro.personalDashboard(user, stats, lang), {
    parse_mode: 'HTML',
    ...kb.personalAreaKeyboard(),
  });
}

/* -------------------------------- התראות -------------------------------- */

async function showAlerts(ctx, { edit = false } = {}) {
  const lang = langOf(ctx);
  const searches = await extra.listSavedSearches(ctx.state.dbUser.id);
  const text = fmtPro.alertsCard(searches, lang);
  const options = { parse_mode: 'HTML', ...kbp.alertsKeyboard(searches, lang) };

  if (edit) {
    try {
      return await ctx.editMessageText(text, options);
    } catch (error) {
      /* נשלח הודעה חדשה */
    }
  }
  return ctx.reply(text, options);
}

async function createAlert(ctx) {
  const t = T(ctx);
  const filters = ctx.session.search || {};
  const hasFilters =
    filters.q ||
    filters.categoryId ||
    filters.location ||
    filters.freeOnly ||
    Number.isFinite(filters.minPrice) ||
    Number.isFinite(filters.maxPrice);

  if (!hasFilters) {
    await ctx.answerCbQuery();
    return ctx.reply(t('alerts.needFilters'), { parse_mode: 'HTML' });
  }

  const settings = await extra.getSettings();
  const maxAlerts = Number(settings.max_alerts || 10);
  const existing = await extra.listSavedSearches(ctx.state.dbUser.id);

  if (existing.length >= maxAlerts) {
    await ctx.answerCbQuery();
    return ctx.reply(t('alerts.limit', { max: maxAlerts }), { parse_mode: 'HTML' });
  }

  await extra.addSavedSearch(ctx.state.dbUser.id, filters, filters.q || '');
  await extra.logEvent('alert_created', ctx.state.dbUser.id, filters);
  await ctx.answerCbQuery(t('common.saved'));
  await ctx.reply(t('alerts.created'), { parse_mode: 'HTML' });
  return showAlerts(ctx);
}

/* --------------------------------- דיווח --------------------------------- */

async function showReportMenu(ctx, listingId) {
  const lang = langOf(ctx);
  const t = T(ctx);
  return ctx.reply(`${t('report.title')}\n${fmtPro.DIVIDER}\n${t('report.pick')}`, {
    parse_mode: 'HTML',
    ...kbp.reportKeyboard(listingId, lang),
  });
}

async function submitReport(ctx, listingId, reason) {
  const t = T(ctx);
  const listing = await db.getListing(listingId);
  if (!listing) return ctx.answerCbQuery(t('common.notFound'), { show_alert: true });

  if (await extra.hasReported(listingId, ctx.state.dbUser.id)) {
    return ctx.answerCbQuery(t('report.already'), { show_alert: true });
  }

  const report = await extra.addReport({ listingId, reporterId: ctx.state.dbUser.id, reason });
  await ctx.answerCbQuery(t('report.thanks'));
  await safeDelete(ctx);
  await ctx.reply(t('report.thanks'), { parse_mode: 'HTML' });

  if (env.ADMIN_GROUP_ID && report) {
    try {
      await ctx.telegram.sendMessage(
        env.ADMIN_GROUP_ID,
        fmtPro.reportCard({ ...report, listing }, 'he'),
        {
          parse_mode: 'HTML',
          disable_web_page_preview: true,
          reply_markup: kbp.adminReportKeyboard(report, 'he').reply_markup,
        }
      );
    } catch (error) {
      console.warn('[pro_user] report dispatch failed:', error.message);
    }
  }
  return true;
}

/* -------------------------------- עזרה -------------------------------- */

async function showHelp(ctx) {
  const t = T(ctx);
  return ctx.reply(
    [
      t('help.title'),
      fmtPro.DIVIDER,
      t('help.body'),
      env.SUPPORT_USERNAME ? `💬 @${fmt.esc(env.SUPPORT_USERNAME)}` : null,
      '',
      t('help.rules'),
    ]
      .filter((line) => line !== null && line !== undefined)
      .join('\n'),
    { parse_mode: 'HTML', ...kb.supportKeyboard() }
  );
}

async function showChannel(ctx) {
  const t = T(ctx);
  if (!env.CHANNEL_URL) return ctx.reply(t('common.notFound'));
  return ctx.reply(`${t('menu.channel')}\n${fmtPro.DIVIDER}`, {
    parse_mode: 'HTML',
    ...kb.channelLinkKeyboard(),
  });
}

/* -------------------------------- Actions -------------------------------- */

function register(bot) {
  bot.command('language', (ctx) => showLanguages(ctx, { edit: false }));
  bot.command('settings', (ctx) => showSettings(ctx));
  bot.command('browse', (ctx) => showBrowse(ctx));
  bot.command('alerts', (ctx) => showAlerts(ctx));
  bot.command('dashboard', (ctx) => showDashboard(ctx));
  bot.command('home', (ctx) => home(ctx));

  bot.action('p:noop', (ctx) => ctx.answerCbQuery());

  bot.action('p:home', async (ctx) => {
    await ctx.answerCbQuery();
    return home(ctx);
  });

  /* ----- שפה והגדרות ----- */
  bot.action('p:set:menu', async (ctx) => {
    await ctx.answerCbQuery();
    return showSettings(ctx, { edit: true });
  });

  bot.action('p:set:lang', async (ctx) => {
    await ctx.answerCbQuery();
    return showLanguages(ctx);
  });

  bot.action(/^p:lang:([a-z]{2})$/, async (ctx) => {
    const code = ctx.match[1];
    if (!i18n.isSupported(code)) return ctx.answerCbQuery('❌');

    await extra.setUserLanguage(ctx.state.dbUser.id, code);
    ctx.session.lang = code;
    ctx.state.dbUser.language = code;
    ctx.lang = code;
    ctx.t = i18n.translator(code);

    await ctx.answerCbQuery(ctx.t('lang.changed', { lang: i18n.localeName(code) }));
    await ctx.reply(ctx.t('lang.changed', { lang: i18n.localeName(code) }), {
      parse_mode: 'HTML',
      ...kbp.mainMenu(code),
    });
    return showSettings(ctx);
  });

  bot.action('p:set:notif', async (ctx) => {
    const current = ctx.state.dbUser.notifications_enabled !== false;
    await extra.setNotifications(ctx.state.dbUser.id, !current);
    ctx.state.dbUser.notifications_enabled = !current;
    await ctx.answerCbQuery(T(ctx)('settings.updated'));
    return showSettings(ctx, { edit: true });
  });

  bot.action('p:set:privacy', async (ctx) => {
    const current = Boolean(ctx.state.dbUser.show_phone);
    await extra.setShowPhone(ctx.state.dbUser.id, !current);
    ctx.state.dbUser.show_phone = !current;
    await ctx.answerCbQuery(T(ctx)('settings.updated'));
    return showSettings(ctx, { edit: true });
  });

  bot.action('p:me:profile', async (ctx) => {
    await ctx.answerCbQuery();
    return showDashboard(ctx);
  });

  /* ----- גלישה ----- */
  bot.action('p:br:menu', async (ctx) => {
    await ctx.answerCbQuery();
    return showBrowse(ctx, { edit: true });
  });

  bot.action('p:br:cat', async (ctx) => {
    await ctx.answerCbQuery();
    return showCategories(ctx);
  });

  bot.action('p:br:near', async (ctx) => {
    await ctx.answerCbQuery();
    const lang = langOf(ctx);
    const t = T(ctx);
    try {
      return await ctx.editMessageText(`${t('browse.nearby')}\n${fmtPro.DIVIDER}`, {
        parse_mode: 'HTML',
        ...kbp.regionsFeedKeyboard(lang),
      });
    } catch (error) {
      return ctx.reply(t('browse.nearby'), { parse_mode: 'HTML', ...kbp.regionsFeedKeyboard(lang) });
    }
  });

  bot.action('p:br:top', async (ctx) => {
    await ctx.answerCbQuery();
    const lang = langOf(ctx);
    const t = T(ctx);
    const sellers = await extra.topSellers(10);

    if (!sellers.length) return ctx.reply(t('common.none'));

    const lines = sellers.map((seller, index) => {
      const average = seller.rating_count ? (seller.rating_sum / seller.rating_count).toFixed(1) : '—';
      const name = seller.username ? `@${fmt.esc(seller.username)}` : fmt.esc(seller.full_name);
      return `${index + 1}. ${name} — 🛍️ ${fmtPro.n(seller.active_listings)} · 🏷️ ${fmtPro.n(
        seller.sold_listings
      )} · ⭐ ${average}`;
    });

    const buttons = sellers.slice(0, 8).map((seller) => ({
      text: `${seller.username ? '@' + seller.username : seller.full_name}`.slice(0, 24),
      callback_data: `p:sel:${seller.id}:0`,
    }));
    const rows = [];
    for (let i = 0; i < buttons.length; i += 2) rows.push(buttons.slice(i, i + 2));

    return ctx.reply([t('browse.topSellers'), fmtPro.DIVIDER, ...lines].join('\n'), {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [...rows, [{ text: t('menu.browse'), callback_data: 'p:br:menu' }]] },
    });
  });

  bot.action(/^p:feed:([a-z]+):(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    await safeDelete(ctx);
    return showFeed(ctx, `feed:${ctx.match[1]}`, Number(ctx.match[2]));
  });

  bot.action(/^p:cat:(\d+):(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    await safeDelete(ctx);
    return showFeed(ctx, `cat:${ctx.match[1]}`, Number(ctx.match[2]));
  });

  bot.action(/^p:reg:(\d+):(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    await safeDelete(ctx);
    return showFeed(ctx, `reg:${ctx.match[1]}`, Number(ctx.match[2]));
  });

  bot.action(/^p:go:(.+):(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const source = ctx.match[1];
    const page = Number(ctx.match[2]);
    await safeDelete(ctx);

    if (source.startsWith('sel:')) {
      return showSellerProfile(ctx, Number(source.split(':')[1]), page);
    }
    return showFeed(ctx, source, page);
  });

  bot.action(/^p:sim:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    return showSimilar(ctx, Number(ctx.match[1]));
  });

  bot.action(/^p:sel:(\d+):(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    return showSellerProfile(ctx, Number(ctx.match[1]), Number(ctx.match[2]));
  });

  /* ----- התראות ----- */
  bot.action('p:al:menu', async (ctx) => {
    await ctx.answerCbQuery();
    return showAlerts(ctx, { edit: true });
  });

  bot.action('p:al:add', (ctx) => createAlert(ctx));

  bot.action(/^p:al:del:(\d+)$/, async (ctx) => {
    await extra.deleteSavedSearch(ctx.state.dbUser.id, Number(ctx.match[1]));
    await ctx.answerCbQuery(T(ctx)('alerts.deleted'));
    return showAlerts(ctx, { edit: true });
  });

  /* ----- דיווחים ----- */
  bot.action(/^p:rep:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    return showReportMenu(ctx, Number(ctx.match[1]));
  });

  bot.action(/^p:rr:(\d+):([a-z]+)$/, (ctx) => submitReport(ctx, Number(ctx.match[1]), ctx.match[2]));
}

module.exports = {
  register,
  home,
  showSettings,
  showLanguages,
  showBrowse,
  showCategories,
  showFeed,
  showSimilar,
  showSellerProfile,
  showDashboard,
  showAlerts,
  createAlert,
  showReportMenu,
  submitReport,
  showHelp,
  showChannel,
  userStats,
  sendCard,
};
