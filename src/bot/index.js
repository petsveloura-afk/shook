'use strict';

/**
 * הרכבת הבוט: Middlewares (סשן ב-DB, זיהוי משתמש), רישום ה-Handlers,
 * ראוטר טקסט/תמונות מרכזי וטיפול בשגיאות.
 *
 * getBot() מחזיר סינגלטון — חיוני ב-Serverless כדי לא לבנות את הבוט בכל בקשה.
 */

const { Telegraf } = require('telegraf');
const env = require('../config/env');
const db = require('../db/supabase');
const kb = require('./keyboards');
const userHandlers = require('./handlers/user');
const adminHandlers = require('./handlers/admin');
const createAd = require('./fsm/createAd');
const pro = require('./pro'); // שכבת השדרוג: ריבוי שפות, גלישה, התראות, אנליטיקס

/* ------------------------------ Middlewares ------------------------------ */

/** סשן מתמיד ב-Postgres — עובד גם ב-Serverless (Vercel) וגם ב-Polling. */
async function sessionMiddleware(ctx, next) {
  if (!ctx.from) return next();

  const key = `u:${ctx.from.id}`;
  let initial = {};
  try {
    initial = (await db.getSession(key)) || {};
  } catch (error) {
    console.error('[session] load failed:', error.message);
  }

  ctx.session = initial;
  const before = JSON.stringify(initial);

  await next();

  const after = JSON.stringify(ctx.session || {});
  if (after === before) return undefined;

  try {
    if (!ctx.session || Object.keys(ctx.session).length === 0) await db.deleteSession(key);
    else await db.saveSession(key, ctx.session);
  } catch (error) {
    console.error('[session] save failed:', error.message);
  }
  return undefined;
}

/** רישום/עדכון המשתמש ב-DB + חסימת משתמשים בסטטוס banned. */
async function identifyMiddleware(ctx, next) {
  if (!ctx.from || ctx.from.is_bot) return next();

  try {
    ctx.state.dbUser = await db.upsertUser(ctx.from);
  } catch (error) {
    console.error('[identify] upsert failed:', error.message);
    return next();
  }

  if (ctx.state.dbUser.status === 'banned' && !env.isAdmin(ctx.from.id)) {
    if (ctx.callbackQuery) {
      return ctx.answerCbQuery('🚫 חשבונך חסום. לערעור פנה לתמיכה.', { show_alert: true });
    }
    if (ctx.chat && ctx.chat.type === 'private') {
      return ctx.reply('🚫 <b>חשבונך חסום</b>\n\nלא ניתן להשתמש בבוט. לערעור פנה לתמיכה.', {
        parse_mode: 'HTML',
      });
    }
    return undefined;
  }

  return next();
}

/* -------------------------------- ראוטרים -------------------------------- */

async function textRouter(ctx) {
  const isPrivate = ctx.chat && ctx.chat.type === 'private';
  const state = ctx.session && ctx.session.state ? ctx.session.state : '';

  // בקבוצות: מגיבים רק לזרימות אדמין (עריכת מודעה, שידור וכו')
  if (!isPrivate) {
    if (state.startsWith('admin:')) return adminHandlers.onText(ctx);
    if (state.startsWith('pro:')) return pro.onText(ctx);
    return undefined;
  }

  if (state.startsWith('ad:')) return createAd.onText(ctx);
  if (state.startsWith('admin:')) return adminHandlers.onText(ctx);
  if (state.startsWith('pro:')) return pro.onText(ctx);
  if (state.startsWith('search:')) return userHandlers.onSearchText(ctx);

  // תפריט רב-לשוני: מזהה את התווית בכל אחת מהשפות הנתמכות
  if (await pro.tryHandleMenuText(ctx)) return undefined;

  return userHandlers.onMenuText(ctx);
}

async function photoRouter(ctx) {
  const state = ctx.session && ctx.session.state ? ctx.session.state : '';
  if (state === 'ad:PHOTOS') return createAd.onPhoto(ctx);
  if (ctx.chat && ctx.chat.type === 'private') {
    return ctx.reply(
      'ℹ️ כדי לצרף תמונות למודעה, התחל בפרסום מודעה חדשה ➕',
      kb.mainMenu()
    );
  }
  return undefined;
}

/* ------------------------------- בניית הבוט ------------------------------- */

function buildBot() {
  const bot = new Telegraf(env.BOT_TOKEN, { handlerTimeout: 90000 });

  bot.use(sessionMiddleware);
  bot.use(identifyMiddleware);

  // שכבת PRO — חייבת להירשם לפני ה-handlers הקיימים (שפה, אנטי-ספאם, הוקים)
  pro.registerEarly(bot);

  // סדר הרישום חשוב: פקודות ו-callbacks לפני הראוטר הכללי.
  userHandlers.register(bot);
  adminHandlers.register(bot);
  createAd.register(bot);

  // מסכי ה-PRO (גלישה, שפות, התראות, מרכז בקרה) — אחרי הקיימים, לפני ראוטר הטקסט
  pro.register(bot);

  bot.on('text', textRouter);
  bot.on('photo', photoRouter);

  // סוגי מדיה שאינם נתמכים באשף
  bot.on(['video', 'document', 'audio', 'voice', 'sticker'], async (ctx) => {
    const state = ctx.session && ctx.session.state ? ctx.session.state : '';
    if (state === 'ad:PHOTOS') {
      return ctx.reply('⚠️ ניתן לצרף תמונות בלבד (לא וידאו/קבצים). שלח תמונה:');
    }
    return undefined;
  });

  bot.catch(async (error, ctx) => {
    console.error(`[bot] error on update ${ctx.updateType}:`, error);
    try {
      if (ctx.callbackQuery) await ctx.answerCbQuery('⚠️ שגיאה זמנית, נסה שוב');
      else if (ctx.chat && ctx.chat.type === 'private') {
        await ctx.reply('⚠️ אירעה שגיאה זמנית. נסה שוב או חזור לתפריט.', kb.mainMenu());
      }
    } catch (replyError) {
      console.error('[bot] failed to report error:', replyError.message);
    }
  });

  return bot;
}

let singleton = null;

function getBot() {
  if (!singleton) singleton = buildBot();
  return singleton;
}

/** רשימת הפקודות שמוצגת בתפריט של טלגרם. */
const COMMANDS = [
  { command: 'start', description: '🏠 התחלה ותפריט ראשי' },
  { command: 'new', description: '➕ פרסום מודעה חדשה' },
  { command: 'search', description: '🔍 חיפוש מוצרים' },
  { command: 'my', description: '📋 המודעות שלי' },
  { command: 'favorites', description: '⭐️ המועדפים שלי' },
  { command: 'cancel', description: '❌ ביטול הפעולה הנוכחית' },
  { command: 'help', description: '📞 תמיכה וכללי פרסום' },
  // --- PRO ---
  { command: 'browse', description: '🧭 גלישה בקטגוריות ובפידים' },
  { command: 'alerts', description: '🔔 ההתראות שלי' },
  { command: 'dashboard', description: '📊 הסטטיסטיקה שלי' },
  { command: 'settings', description: '⚙️ הגדרות' },
  { command: 'language', description: '🌐 Language / שפה / اللغة' },
];

async function registerCommands(bot) {
  try {
    await bot.telegram.setMyCommands(COMMANDS);
  } catch (error) {
    console.warn('[bot] setMyCommands failed:', error.message);
  }
}

module.exports = { getBot, buildBot, registerCommands, COMMANDS };
