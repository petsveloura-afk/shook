'use strict';

/**
 * שכבת החיבור של השדרוג (PRO) אל הבוט הקיים.
 *
 * העיקרון: לא נוגעים בזרימות הקיימות — עוטפים אותן.
 *  • localeMiddleware  — מזהה שפה ומזריק ctx.t / ctx.lang לכל handler
 *  • guardPublish      — שער אנטי-ספאם לפני שליחת מודעה למודרציה
 *  • afterApprove      — הוק שמפעיל התראות אחרי שהאדמין אישר מודעה
 *  • menu resolver     — מזהה לחיצות תפריט בכל אחת מהשפות הנתמכות
 */

const env = require('../config/env');
const db = require('../db/supabase');
const extra = require('../db/extra');
const i18n = require('../i18n');
const kb = require('./keyboards');
const kbp = require('./keyboards_pro');
const createAd = require('./fsm/createAd');
const userHandlers = require('./handlers/user');
const proUser = require('./handlers/pro_user');
const proAdmin = require('./handlers/pro_admin');
const antispam = require('../services/antispam');
const alerts = require('../services/alerts');
const publish = require('./publish');

/* ------------------------------ Middlewares ------------------------------ */

/** מזריק שפה לכל עדכון (users.language ← session ← telegram ← ברירת מחדל). */
async function localeMiddleware(ctx, next) {
  const lang = i18n.detect({
    dbUser: ctx.state && ctx.state.dbUser,
    session: ctx.session,
    from: ctx.from,
  });

  ctx.lang = lang;
  ctx.t = i18n.translator(lang);

  if (ctx.session && ctx.session.lang !== lang) ctx.session.lang = lang;
  return next();
}

/** שער לפני "אישור ושליחה לאישור מנהל": תחזוקה, מגבלות, מילים חסומות, כפילויות. */
async function guardPublish(ctx, next) {
  const t = ctx.t || i18n.translator(i18n.DEFAULT_LANG);
  const user = ctx.state.dbUser;
  const draft = (ctx.session && ctx.session.draft) || {};

  if (!user) return next();

  if (await antispam.isMaintenance()) {
    await ctx.answerCbQuery('🚧', { show_alert: true });
    return ctx.reply('🚧 המערכת בתחזוקה קצרה. נסה שוב בעוד מספר דקות.');
  }

  let verdict = { ok: true };
  try {
    verdict = await antispam.checkDraft(user, draft);
  } catch (error) {
    console.warn('[pro] antispam check failed:', error.message);
  }

  if (!verdict.ok) {
    await ctx.answerCbQuery();
    return ctx.reply(t(verdict.key, verdict.vars), { parse_mode: 'HTML' });
  }

  await next();

  // אחרי שהמודעה נשמרה: עדכון מונה + אישור אוטומטי אם מופעל בהגדרות.
  try {
    await extra.bumpUserAdCounter(user.id);
    await extra.logEvent('listing_submitted', user.id, {});

    if (await antispam.isAutoApprove()) {
      const pending = await db.listUserListings(user.id, 0, 1, ['pending']);
      const listing = pending.items[0];
      if (listing) {
        const published = await publish.publishListing(ctx.telegram, listing.id);
        await ctx.reply('⚡ ' + (ctx.t ? ctx.t('common.saved') : '✅'), { parse_mode: 'HTML' });
        await alerts.notifyMatches(ctx.telegram, published);
      }
    }
  } catch (error) {
    console.warn('[pro] post-publish hook failed:', error.message);
  }
  return undefined;
}

/** אחרי אישור אדמין (a:ok) — הפעלת מנוע ההתראות. */
async function afterApprove(ctx, next) {
  const id = ctx.match && ctx.match[1] ? Number(ctx.match[1]) : null;
  await next();

  if (!id) return undefined;
  try {
    const listing = await db.getListing(id);
    if (listing && listing.status === 'approved') {
      const sent = await alerts.notifyMatches(ctx.telegram, listing);
      if (sent) {
        await ctx.reply(`🔔 ${sent} התראות נשלחו למשתמשים שחיפשו מוצר כזה.`).catch(() => {});
      }
    }
  } catch (error) {
    console.warn('[pro] afterApprove hook failed:', error.message);
  }
  return undefined;
}

/* ------------------------------ תפריט רב-לשוני ------------------------------ */

const MENU_ACTIONS = {
  'menu.post': (ctx) => createAd.start(ctx),
  'menu.search': (ctx) => userHandlers.showSearchMenu(ctx),
  'menu.browse': (ctx) => proUser.showBrowse(ctx),
  'menu.mine': (ctx) => proUser.showDashboard(ctx),
  'menu.favorites': (ctx) => userHandlers.showFavorites(ctx, 0),
  'menu.alerts': (ctx) => proUser.showAlerts(ctx),
  'menu.settings': (ctx) => proUser.showSettings(ctx),
  'menu.channel': (ctx) => proUser.showChannel(ctx),
  'menu.support': (ctx) => proUser.showHelp(ctx),
};

/** מפה: כל תווית תפריט בכל שפה ← פעולה. נבנית פעם אחת בטעינה. */
const MENU_INDEX = (() => {
  const map = new Map();
  Object.keys(MENU_ACTIONS).forEach((key) => {
    i18n.allValues(key).forEach((label) => map.set(label, key));
  });

  // תוויות מדור קודם (keyboards.js) — שומרות על תאימות מלאה לאחור
  map.set(kb.MENU.NEW, 'menu.post');
  map.set(kb.MENU.SEARCH, 'menu.search');
  map.set(kb.MENU.ME, 'menu.mine');
  map.set(kb.MENU.FAV, 'menu.favorites');
  map.set(kb.MENU.CHANNEL, 'menu.channel');
  map.set(kb.MENU.SUPPORT, 'menu.support');
  return map;
})();

/** כל תוויות ה"ביטול" בכל השפות. */
const CANCEL_LABELS = new Set([...i18n.allValues('common.cancel'), kb.CANCEL]);

/**
 * מנסה לטפל בטקסט כלחיצת תפריט בכל שפה.
 * @returns {Promise<boolean>} true אם טופל כאן
 */
async function tryHandleMenuText(ctx) {
  const text = (ctx.message && ctx.message.text ? ctx.message.text : '').trim();
  if (!text) return false;

  if (CANCEL_LABELS.has(text)) {
    delete ctx.session.state;
    await ctx.reply(ctx.t('common.mainMenu'), kbp.mainMenu(ctx.lang));
    return true;
  }

  const key = MENU_INDEX.get(text);
  if (!key) return false;

  await MENU_ACTIONS[key](ctx);
  return true;
}

/** ראוטר הטקסט של מצבי ה-PRO (state שמתחיל ב-'pro:'). */
async function onText(ctx) {
  return proAdmin.onText(ctx);
}

/* -------------------------------- רישום -------------------------------- */

/**
 * נרשם מוקדם — לפני ה-handlers הקיימים.
 * חייב לרוץ אחרי identifyMiddleware כדי ש-ctx.state.dbUser יהיה זמין.
 */
function registerEarly(bot) {
  bot.use(localeMiddleware);

  // /start רב-לשוני — רק כשאין deep link (deep links ממשיכים ל-handler המקורי)
  bot.start(async (ctx, next) => {
    const payload = (ctx.startPayload || '').trim();

    if (payload === 'alerts') return proUser.showAlerts(ctx);
    if (payload === 'settings') return proUser.showSettings(ctx);
    if (payload === 'browse') return proUser.showBrowse(ctx);
    if (payload) return next();

    await extra.logEvent('start', ctx.state.dbUser && ctx.state.dbUser.id, {
      lang: ctx.lang,
    });
    return proUser.home(ctx);
  });

  bot.action('pv:confirm', guardPublish);
  bot.action(/^a:ok:(\d+)$/, afterApprove);
}

/** נרשם אחרי ה-handlers הקיימים ולפני ראוטר הטקסט הכללי. */
function register(bot) {
  proUser.register(bot);
  proAdmin.register(bot);
}

module.exports = {
  localeMiddleware,
  guardPublish,
  afterApprove,
  tryHandleMenuText,
  onText,
  registerEarly,
  register,
  MENU_INDEX,
  MENU_ACTIONS,
  CANCEL_LABELS,
};
