'use strict';

/**
 * פאנל הניהול: מטריקות, תור מודרציה (אישור/דחייה/עריכה/חסימה),
 * שידור הודעות לכל המשתמשים, ניהול קטגוריות והסרת מודעות.
 */

const env = require('../../config/env');
const db = require('../../db/supabase');
const kb = require('../keyboards');
const fmt = require('../formatters');
const publish = require('../publish');
const createAd = require('../fsm/createAd');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* --------------------------------- עזרים --------------------------------- */

function isAdmin(ctx) {
  return Boolean(ctx.from && env.isAdmin(ctx.from.id));
}

async function guard(ctx) {
  if (isAdmin(ctx)) return true;
  if (ctx.callbackQuery) await ctx.answerCbQuery('⛔ הפעולה מיועדת למנהלים בלבד', { show_alert: true });
  else await ctx.reply('⛔ הפעולה מיועדת למנהלים בלבד.');
  return false;
}

/** קישור ישיר לפוסט בערוץ (עובד גם לערוץ פרטי דרך /c/). */
function postLink(listing) {
  if (!listing.channel_message_id || !env.CHANNEL_ID) return null;
  const id = String(env.CHANNEL_ID);
  if (id.startsWith('@')) return `https://t.me/${id.slice(1)}/${listing.channel_message_id}`;
  if (id.startsWith('-100')) return `https://t.me/c/${id.slice(4)}/${listing.channel_message_id}`;
  return null;
}

function adminName(ctx) {
  return ctx.from.username
    ? `@${ctx.from.username}`
    : [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' ');
}

/** מעדכן את הודעת המודרציה עם התוצאה ומסיר את הכפתורים. */
async function stampModeration(ctx, listing, statusLine) {
  const text = `${fmt.moderationCard(listing)}\n\n➖➖➖➖➖➖➖➖➖➖➖\n${statusLine}`;
  try {
    await ctx.editMessageText(text, {
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      reply_markup: { inline_keyboard: [] },
    });
  } catch (error) {
    await ctx.reply(statusLine, { parse_mode: 'HTML' });
  }
}

async function notifyUser(telegram, telegramId, text, extra = {}) {
  if (!telegramId) return false;
  try {
    await telegram.sendMessage(telegramId, text, { parse_mode: 'HTML', ...extra });
    return true;
  } catch (error) {
    console.warn(`[admin] notify ${telegramId} failed: ${error.message}`);
    return false;
  }
}

/* ------------------------------- פאנל ראשי ------------------------------- */

async function showPanel(ctx, { edit = false } = {}) {
  const metrics = await db.getMetrics();
  const text = fmt.metricsCard(metrics);
  const extra = { parse_mode: 'HTML', ...kb.adminPanelKeyboard() };

  if (edit) {
    try {
      return await ctx.editMessageText(text, extra);
    } catch (error) {
      /* ההודעה זהה — נשלח חדשה */
    }
  }
  return ctx.reply(text, extra);
}

async function showQueue(ctx) {
  const pending = await db.listPendingListings(10);
  if (!pending.length) {
    return ctx.reply('✅ אין מודעות הממתינות לאישור. הכל נקי!', kb.backToPanelKeyboard());
  }

  await ctx.reply(`📥 <b>${pending.length} מודעות ממתינות לאישור:</b>`, { parse_mode: 'HTML' });
  for (const listing of pending) {
    await createAd.sendToModeration(ctx.telegram, listing);
    await sleep(120);
  }
  return true;
}

/* ------------------------------- שידור המוני ------------------------------- */

async function runBroadcast(ctx, message) {
  const ids = await db.getAllActiveTelegramIds();
  const startedAt = Date.now();
  const deadline = 50000; // שומרים מרווח מתחת למגבלת ה-60s של Vercel

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  const progress = await ctx.reply(`📢 מתחיל שידור ל-${fmt.formatNumber(ids.length)} משתמשים...`);

  for (let i = 0; i < ids.length; i += 1) {
    if (Date.now() - startedAt > deadline) {
      skipped = ids.length - i;
      break;
    }
    try {
      await ctx.telegram.sendMessage(ids[i], message, { parse_mode: 'HTML', disable_web_page_preview: true });
      sent += 1;
    } catch (error) {
      failed += 1;
    }
    await sleep(env.BROADCAST_DELAY_MS);

    if (sent && sent % 100 === 0) {
      try {
        await ctx.telegram.editMessageText(
          progress.chat.id,
          progress.message_id,
          undefined,
          `📢 שידור בתהליך... ${fmt.formatNumber(sent)}/${fmt.formatNumber(ids.length)}`
        );
      } catch (error) {
        /* noop */
      }
    }
  }

  await db.logBroadcast({
    adminId: ctx.from.id,
    message,
    sentCount: sent,
    failedCount: failed,
  });

  return ctx.reply(
    [
      '📢 <b>סיכום השידור</b>',
      '',
      `✅ נשלחו: ${fmt.formatNumber(sent)}`,
      `❌ נכשלו (חסמו את הבוט): ${fmt.formatNumber(failed)}`,
      skipped ? `⏭️ לא נשלחו (מגבלת זמן): ${fmt.formatNumber(skipped)}` : null,
      '',
      skipped ? 'ℹ️ הרץ את השידור שוב כדי להשלים את היתר.' : '🎉 השידור הושלם.',
    ]
      .filter((line) => line !== null && line !== undefined)
      .join('\n'),
    { parse_mode: 'HTML', ...kb.backToPanelKeyboard() }
  );
}

/* -------------------------------- טקסט אדמין -------------------------------- */

async function onText(ctx) {
  if (!isAdmin(ctx)) {
    delete ctx.session.state;
    return false;
  }

  const text = (ctx.message.text || '').trim();
  const state = ctx.session.state || '';

  if (text === kb.CANCEL) {
    delete ctx.session.state;
    delete ctx.session.admin;
    return ctx.reply('❌ הפעולה בוטלה.', kb.mainMenu());
  }

  /* --- שידור --- */
  if (state === 'admin:broadcast') {
    ctx.session.admin = { broadcast: text };
    delete ctx.session.state;
    return ctx.reply(
      [
        '📢 <b>תצוגה מקדימה של ההודעה:</b>',
        '➖➖➖➖➖➖➖➖➖➖➖',
        '',
        text,
        '',
        '➖➖➖➖➖➖➖➖➖➖➖',
        'לשלוח לכל המשתמשים?',
      ].join('\n'),
      { parse_mode: 'HTML', ...kb.broadcastConfirmKeyboard() }
    );
  }

  /* --- הוספת קטגוריה --- */
  if (state === 'admin:catadd') {
    const match = text.match(/^(\S+)\s+(.{2,40})$/);
    if (!match) {
      return ctx.reply("⚠️ פורמט לא תקין. שלח: <code>🚗 רכב ואופנועים</code>", { parse_mode: 'HTML' });
    }
    const [, emoji, name] = match;
    const asciiSlug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    const slug = asciiSlug || `cat-${Date.now()}`;

    try {
      const category = await db.addCategory({ name_he: name.trim(), emoji, slug, sort_order: 500 });
      delete ctx.session.state;
      await ctx.reply(
        `✅ הקטגוריה נוספה: <b>${category.emoji} ${fmt.esc(category.name_he)}</b>`,
        { parse_mode: 'HTML' }
      );
      const categories = await db.listCategories();
      return ctx.reply('🗂️ <b>ניהול קטגוריות</b>\nלחיצה על קטגוריה תמחק אותה:', {
        parse_mode: 'HTML',
        ...kb.adminCategoriesKeyboard(categories),
      });
    } catch (error) {
      return ctx.reply(`⚠️ ההוספה נכשלה: ${fmt.esc(error.message)}`, { parse_mode: 'HTML' });
    }
  }

  /* --- הסרת מודעה לפי מזהה --- */
  if (state === 'admin:rm') {
    const id = Number((text.match(/(\d+)/) || [])[1]);
    if (!id) return ctx.reply('⚠️ שלח מזהה מודעה מספרי, לדוגמה: <code>42</code>', { parse_mode: 'HTML' });

    const listing = await db.getListing(id);
    if (!listing) return ctx.reply(`⚠️ לא נמצאה מודעה עם מזהה ${id}.`);

    await publish.removeFromChannel(ctx.telegram, listing);
    await db.updateListing(listing.id, {
      status: 'deleted',
      channel_message_id: null,
      channel_media_message_ids: [],
    });
    delete ctx.session.state;

    await notifyUser(
      ctx.telegram,
      listing.seller && listing.seller.telegram_id,
      [
        '🗑️ <b>המודעה שלך הוסרה על ידי מנהל</b>',
        '',
        `🛍️ ${fmt.esc(listing.title)}`,
        `🆔 <code>${fmt.adId(listing.id)}</code>`,
        '',
        'לפרטים נוספים ניתן לפנות לתמיכה.',
      ].join('\n')
    );

    return ctx.reply(
      `🗑️ המודעה <code>${fmt.adId(listing.id)}</code> הוסרה מהערוץ ומהמערכת.`,
      { parse_mode: 'HTML', ...kb.backToPanelKeyboard() }
    );
  }

  /* --- חסימה / שחרור משתמש --- */
  if (state === 'admin:ban') {
    const telegramId = Number((text.match(/(\d+)/) || [])[1]);
    if (!telegramId) return ctx.reply('⚠️ שלח Telegram ID מספרי של המשתמש.');

    const user = await db.getUserByTelegramId(telegramId);
    if (!user) return ctx.reply(`⚠️ לא נמצא משתמש עם המזהה ${telegramId}.`);

    const nextStatus = user.status === 'banned' ? 'active' : 'banned';
    await db.setUserStatus(user.id, nextStatus, nextStatus === 'banned' ? 'הפרת תקנון' : null);
    delete ctx.session.state;

    await notifyUser(
      ctx.telegram,
      user.telegram_id,
      nextStatus === 'banned'
        ? '🚫 <b>חשבונך נחסם</b>\n\nלא ניתן לפרסם מודעות. לערעור פנה לתמיכה.'
        : '✅ <b>החסימה הוסרה</b>\n\nניתן לחזור ולהשתמש בבוט. שמור על כללי הפרסום 🙏'
    );

    return ctx.reply(
      nextStatus === 'banned'
        ? `🚫 המשתמש <b>${fmt.esc(user.full_name)}</b> נחסם.`
        : `✅ החסימה הוסרה מהמשתמש <b>${fmt.esc(user.full_name)}</b>.`,
      { parse_mode: 'HTML', ...kb.backToPanelKeyboard() }
    );
  }

  /* --- עריכת מודעה על ידי אדמין --- */
  const editMatch = state.match(/^admin:edit:(\d+):(title|description|price|location)$/);
  if (editMatch) {
    const listingId = Number(editMatch[1]);
    const field = editMatch[2];
    const patch = {};

    if (field === 'price') {
      const value = Number(text.replace(/[₪,\s]/g, ''));
      if (!Number.isFinite(value) || value < 0) return ctx.reply('⚠️ מחיר לא תקין. שלח מספר:');
      patch.price = value;
      patch.price_type = value === 0 ? 'free' : 'fixed';
    } else if (field === 'title') {
      if (text.length < 5 || text.length > 50) return ctx.reply('⚠️ הכותרת חייבת להיות 5-50 תווים:');
      patch.title = text;
    } else if (field === 'description') {
      if (text.length < 10 || text.length > 500) return ctx.reply('⚠️ התיאור חייב להיות 10-500 תווים:');
      patch.description = text;
    } else {
      patch.location = text.slice(0, 60);
    }

    const updated = await db.updateListing(listingId, patch);
    delete ctx.session.state;

    if (!updated) return ctx.reply('⚠️ המודעה לא נמצאה.');

    await ctx.reply('✅ <b>המודעה עודכנה.</b>', { parse_mode: 'HTML' });
    return ctx.reply(fmt.moderationCard(updated), {
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      reply_markup: kb.moderationKeyboard(updated).reply_markup,
    });
  }

  delete ctx.session.state;
  return false;
}

/* --------------------------------- Actions --------------------------------- */

function register(bot) {
  bot.command('admin', async (ctx) => {
    if (!(await guard(ctx))) return false;
    return showPanel(ctx);
  });

  bot.command('stats', async (ctx) => {
    if (!(await guard(ctx))) return false;
    return showPanel(ctx);
  });

  bot.command('pending', async (ctx) => {
    if (!(await guard(ctx))) return false;
    return showQueue(ctx);
  });

  /* ---------- פאנל ---------- */
  bot.action('a:panel', async (ctx) => {
    if (!(await guard(ctx))) return false;
    await ctx.answerCbQuery('מרענן...');
    return showPanel(ctx, { edit: true });
  });

  bot.action('a:queue', async (ctx) => {
    if (!(await guard(ctx))) return false;
    await ctx.answerCbQuery();
    return showQueue(ctx);
  });

  /* ---------- שידור ---------- */
  bot.action('a:bc', async (ctx) => {
    if (!(await guard(ctx))) return false;
    await ctx.answerCbQuery();
    ctx.session.state = 'admin:broadcast';
    return ctx.reply(
      '📢 <b>שידור לכל המשתמשים</b>\n\nשלח את ההודעה שתישלח לכולם (ניתן להשתמש ב-HTML: <code>&lt;b&gt;מודגש&lt;/b&gt;</code>).',
      { parse_mode: 'HTML', ...kb.cancelOnly() }
    );
  });

  bot.action('a:bcok', async (ctx) => {
    if (!(await guard(ctx))) return false;
    const message = ctx.session.admin && ctx.session.admin.broadcast;
    if (!message) return ctx.answerCbQuery('⚠️ אין הודעה לשליחה', { show_alert: true });

    await ctx.answerCbQuery('שולח...');
    delete ctx.session.admin;
    try {
      await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
    } catch (error) {
      /* noop */
    }
    return runBroadcast(ctx, message);
  });

  bot.action('a:bccancel', async (ctx) => {
    if (!(await guard(ctx))) return false;
    await ctx.answerCbQuery('בוטל');
    delete ctx.session.admin;
    delete ctx.session.state;
    return ctx.reply('❌ השידור בוטל.', kb.backToPanelKeyboard());
  });

  /* ---------- קטגוריות ---------- */
  bot.action('a:cats', async (ctx) => {
    if (!(await guard(ctx))) return false;
    await ctx.answerCbQuery();
    const categories = await db.listCategories();
    return ctx.reply('🗂️ <b>ניהול קטגוריות</b>\nלחיצה על קטגוריה תמחק אותה:', {
      parse_mode: 'HTML',
      ...kb.adminCategoriesKeyboard(categories),
    });
  });

  bot.action('a:catadd', async (ctx) => {
    if (!(await guard(ctx))) return false;
    await ctx.answerCbQuery();
    ctx.session.state = 'admin:catadd';
    return ctx.reply(
      '➕ שלח את הקטגוריה בפורמט: <code>אימוג\'י שם הקטגוריה</code>\n\nלדוגמה: <code>🎸 כלי נגינה</code>',
      { parse_mode: 'HTML', ...kb.cancelOnly() }
    );
  });

  bot.action(/^a:catdel:(\d+)$/, async (ctx) => {
    if (!(await guard(ctx))) return false;
    const id = Number(ctx.match[1]);
    const category = await db.getCategory(id);
    if (!category) return ctx.answerCbQuery('⚠️ הקטגוריה לא נמצאה', { show_alert: true });

    await db.deleteCategory(id);
    await ctx.answerCbQuery(`🗑️ ${category.name_he} נמחקה`);

    const categories = await db.listCategories();
    try {
      return await ctx.editMessageReplyMarkup(kb.adminCategoriesKeyboard(categories).reply_markup);
    } catch (error) {
      return ctx.reply('🗂️ הקטגוריה נמחקה.', kb.backToPanelKeyboard());
    }
  });

  /* ---------- הסרת מודעה / חסימה ---------- */
  bot.action('a:rm', async (ctx) => {
    if (!(await guard(ctx))) return false;
    await ctx.answerCbQuery();
    ctx.session.state = 'admin:rm';
    return ctx.reply('🗑️ שלח את מזהה המודעה להסרה (המספר מתוך <code>#ID0042</code> → 42):', {
      parse_mode: 'HTML',
      ...kb.cancelOnly(),
    });
  });

  bot.action('a:banmenu', async (ctx) => {
    if (!(await guard(ctx))) return false;
    await ctx.answerCbQuery();
    ctx.session.state = 'admin:ban';
    return ctx.reply(
      '🚫 שלח את ה-Telegram ID של המשתמש.\n\nשליחה חוזרת של אותו מזהה תשחרר את החסימה.',
      kb.cancelOnly()
    );
  });

  /* ---------- מודרציה: אישור ---------- */
  bot.action(/^a:ok:(\d+)$/, async (ctx) => {
    if (!(await guard(ctx))) return false;
    const id = Number(ctx.match[1]);
    const listing = await db.getListing(id);

    if (!listing) return ctx.answerCbQuery('⚠️ המודעה לא נמצאה', { show_alert: true });
    if (listing.status === 'approved') return ctx.answerCbQuery('ℹ️ המודעה כבר מפורסמת');

    await ctx.answerCbQuery('מפרסם...');

    let published;
    try {
      published = await publish.publishListing(ctx.telegram, id);
    } catch (error) {
      console.error('[admin] publish failed:', error.message);
      return ctx.reply(`⚠️ הפרסום נכשל: ${fmt.esc(error.message)}`, { parse_mode: 'HTML' });
    }

    await stampModeration(ctx, published, `🟢 <b>אושר ופורסם</b> על ידי ${fmt.esc(adminName(ctx))}`);

    const link = postLink(published);
    await notifyUser(
      ctx.telegram,
      published.seller && published.seller.telegram_id,
      [
        '🎉 <b>המודעה שלך אושרה ופורסמה!</b>',
        '',
        `🛍️ ${fmt.esc(published.title)}`,
        `💰 ${fmt.formatPrice(published)}`,
        `🆔 <code>${fmt.adId(published.id)}</code>`,
        '',
        'בהצלחה במכירה! 🍀',
      ].join('\n'),
      link ? { reply_markup: { inline_keyboard: [[{ text: '📢 צפה במודעה בערוץ', url: link }]] } } : {}
    );
    return true;
  });

  /* ---------- מודרציה: דחייה ---------- */
  bot.action(/^a:rej:(\d+)$/, async (ctx) => {
    if (!(await guard(ctx))) return false;
    await ctx.answerCbQuery();
    return ctx.editMessageReplyMarkup(kb.rejectReasonsKeyboard(Number(ctx.match[1])).reply_markup);
  });

  bot.action(/^a:rr:(\d+):([a-z]+)$/, async (ctx) => {
    if (!(await guard(ctx))) return false;
    const id = Number(ctx.match[1]);
    const code = ctx.match[2];
    const reasonLabel = kb.REJECT_REASONS[code] || 'לא עומד בתקנון';

    const listing = await db.getListing(id);
    if (!listing) return ctx.answerCbQuery('⚠️ המודעה לא נמצאה', { show_alert: true });

    const updated = await db.updateListing(id, { status: 'rejected', reject_reason: code });
    await ctx.answerCbQuery('🔴 נדחה');
    await stampModeration(
      ctx,
      updated,
      `🔴 <b>נדחה</b> (${fmt.esc(reasonLabel)}) על ידי ${fmt.esc(adminName(ctx))}`
    );

    await notifyUser(
      ctx.telegram,
      updated.seller && updated.seller.telegram_id,
      [
        '🔴 <b>המודעה שלך נדחתה</b>',
        '',
        `🛍️ ${fmt.esc(updated.title)}`,
        `📌 <b>סיבה:</b> ${fmt.esc(reasonLabel)}`,
        '',
        'ניתן לתקן ולפרסם מודעה חדשה דרך התפריט ➕',
      ].join('\n')
    );
    return true;
  });

  bot.action(/^a:back:(\d+)$/, async (ctx) => {
    if (!(await guard(ctx))) return false;
    await ctx.answerCbQuery();
    const listing = await db.getListing(Number(ctx.match[1]));
    if (!listing) return ctx.answerCbQuery('⚠️ המודעה לא נמצאה', { show_alert: true });
    return ctx.editMessageReplyMarkup(kb.moderationKeyboard(listing).reply_markup);
  });

  /* ---------- מודרציה: עריכה ---------- */
  bot.action(/^a:ed:(\d+)$/, async (ctx) => {
    if (!(await guard(ctx))) return false;
    await ctx.answerCbQuery();
    return ctx.editMessageReplyMarkup(kb.adminEditFieldsKeyboard(Number(ctx.match[1])).reply_markup);
  });

  bot.action(/^a:ef:(\d+):(title|description|price|location)$/, async (ctx) => {
    if (!(await guard(ctx))) return false;
    await ctx.answerCbQuery();
    const id = Number(ctx.match[1]);
    const field = ctx.match[2];
    ctx.session.state = `admin:edit:${id}:${field}`;

    const labels = {
      title: 'שם המוצר החדש (5-50 תווים)',
      description: 'התיאור החדש (10-500 תווים)',
      price: 'המחיר החדש (מספר בשקלים)',
      location: 'המיקום החדש',
    };

    return ctx.reply(`✏️ שלח את ${labels[field]} עבור מודעה <code>${fmt.adId(id)}</code>:`, {
      parse_mode: 'HTML',
      ...kb.cancelOnly(),
    });
  });

  /* ---------- מודרציה: חסימת המפרסם ---------- */
  bot.action(/^a:ban:(\d+)$/, async (ctx) => {
    if (!(await guard(ctx))) return false;
    const listing = await db.getListing(Number(ctx.match[1]));
    if (!listing) return ctx.answerCbQuery('⚠️ המודעה לא נמצאה', { show_alert: true });

    await db.setUserStatus(listing.user_id, 'banned', 'הפרת תקנון — נחסם ממסך המודרציה');
    const updated = await db.updateListing(listing.id, { status: 'rejected', reject_reason: 'spam' });

    await ctx.answerCbQuery('🚫 המשתמש נחסם');
    await stampModeration(
      ctx,
      updated,
      `🚫 <b>המשתמש נחסם</b> והמודעה נדחתה על ידי ${fmt.esc(adminName(ctx))}`
    );

    await notifyUser(
      ctx.telegram,
      listing.seller && listing.seller.telegram_id,
      '🚫 <b>חשבונך נחסם</b>\n\nהמודעה שפרסמת אינה עומדת בכללי הפרסום. לערעור פנה לתמיכה.'
    );
    return true;
  });
}

module.exports = {
  register,
  onText,
  showPanel,
  showQueue,
  isAdmin,
  postLink,
};
