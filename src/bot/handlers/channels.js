'use strict';

/**
 * ניהול ערוצים וקבוצות שהבוט מחובר אליהם — "🗂️ ערוצים וקבוצות" בפאנל הניהול.
 *
 * זרימה:
 *  1. מנהל מוסיף את הבוט כאדמין לערוץ/קבוצה כלשהם.
 *  2. הבוט מזהה זאת אוטומטית (my_chat_member) ושולח לכל האדמינים (ADMIN_IDS)
 *     הודעה פרטית עם כפתורים: "ערוץ פרסום" / "קבוצת אישור מנהלים" / "התעלם".
 *  3. הבחירה נשמרת בטבלת bot_destinations (ראה schema_channels.sql) ומיד
 *     נלקחת בחשבון על ידי src/services/destinations.js — בלי לגעת ב-.env.
 *
 * אם הבוט מוסר/עוזב צ'אט שהיה מוגדר, היעד מוסר אוטומטית מהרשימה.
 */

const { Markup } = require('telegraf');
const env = require('../../config/env');
const db = require('../../db/supabase');
const fmt = require('../formatters');

const ROLE_LABELS = {
  channel: 'ערוץ פרסום',
  admin_group: 'קבוצת אישור מנהלים',
};

function isAdmin(ctx) {
  return Boolean(ctx.from && env.isAdmin(ctx.from.id));
}

async function guard(ctx) {
  if (isAdmin(ctx)) return true;
  if (ctx.callbackQuery) await ctx.answerCbQuery('⛔ הפעולה מיועדת למנהלים בלבד', { show_alert: true });
  else await ctx.reply('⛔ הפעולה מיועדת למנהלים בלבד.');
  return false;
}

function roleKeyboard(chatId) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('📢 ערוץ פרסום', `dst:set:channel:${chatId}`)],
    [Markup.button.callback('🛡️ קבוצת אישור מנהלים', `dst:set:admin_group:${chatId}`)],
    [Markup.button.callback('🙈 התעלם', `dst:ignore:${chatId}`)],
  ]);
}

/* ------------------------------ פאנל ניהול ------------------------------ */

async function showPanel(ctx) {
  if (!(await guard(ctx))) return false;

  const [channels, groups] = await Promise.all([
    db.listDestinations('channel'),
    db.listDestinations('admin_group'),
  ]);

  const lines = ['🗂️ <b>ערוצים וקבוצות מחוברים</b>', ''];

  lines.push('📢 <b>ערוצי פרסום מודעות:</b>');
  if (channels.length) {
    channels.forEach((row) => lines.push(`• ${fmt.esc(row.chat_title || row.chat_id)} — <code>${row.chat_id}</code>`));
  } else {
    lines.push(env.CHANNEL_ID ? `• (מוגדר מה-ENV) <code>${fmt.esc(env.CHANNEL_ID)}</code>` : '• לא הוגדר ערוץ');
  }

  lines.push('');
  lines.push('🛡️ <b>קבוצות אישור מנהלים:</b>');
  if (groups.length) {
    groups.forEach((row) => lines.push(`• ${fmt.esc(row.chat_title || row.chat_id)} — <code>${row.chat_id}</code>`));
  } else {
    lines.push(
      env.ADMIN_GROUP_ID
        ? `• (מוגדר מה-ENV) <code>${fmt.esc(env.ADMIN_GROUP_ID)}</code>`
        : '• לא הוגדרה קבוצה — בקשות אישור נשלחות ישירות לפרטי כל אדמין'
    );
  }

  lines.push('');
  lines.push('➕ <b>להוספת ערוץ/קבוצה חדשים:</b> הוסף את הבוט כמנהל (Admin) לערוץ או לקבוצה הרצויים — תישלח אליך הודעה פרטית לבחירת התפקיד.');

  const rows = [];
  channels.forEach((row) =>
    rows.push([Markup.button.callback(`🗑️ הסר ערוץ: ${row.chat_title || row.chat_id}`, `dst:rm:channel:${row.chat_id}`)])
  );
  groups.forEach((row) =>
    rows.push([Markup.button.callback(`🗑️ הסר קבוצה: ${row.chat_title || row.chat_id}`, `dst:rm:admin_group:${row.chat_id}`)])
  );
  rows.push([Markup.button.callback('🔄 רענון', 'a:channels')]);
  rows.push([Markup.button.callback('↩️ חזרה לפאנל', 'a:panel')]);

  const payload = { parse_mode: 'HTML', disable_web_page_preview: true, ...Markup.inlineKeyboard(rows) };

  if (ctx.callbackQuery) {
    try {
      return await ctx.editMessageText(lines.join('\n'), payload);
    } catch (error) {
      /* ההודעה זהה — נשלח חדשה */
    }
  }
  return ctx.reply(lines.join('\n'), payload);
}

/* --------------------------- זיהוי my_chat_member --------------------------- */

/** מופעל כאשר סטטוס הבוט משתנה בצ'אט (נוסף/הוסר/קודם לאדמין). */
async function onMyChatMember(ctx) {
  const update = ctx.myChatMember;
  if (!update || !update.chat) return;

  const chat = update.chat;
  if (!['group', 'supergroup', 'channel'].includes(chat.type)) return;

  const newStatus = update.new_chat_member && update.new_chat_member.status;
  const oldStatus = update.old_chat_member && update.old_chat_member.status;

  // הבוט הוסר/עזב — מנקים יעד קיים (אם היה מוגדר) כדי לא לנסות לשלוח לצ'אט שאין בו יותר
  if (['left', 'kicked'].includes(newStatus)) {
    try {
      await db.removeDestination(chat.id, 'channel');
      await db.removeDestination(chat.id, 'admin_group');
    } catch (error) {
      /* המיגרציה כנראה לא הורצה — אין מה לנקות */
    }
    return;
  }

  // הבוט קודם לאדמין (ולא היה אדמין קודם) — שואלים את המנהלים מה התפקיד
  if (newStatus === 'administrator' && oldStatus !== 'administrator') {
    const title = chat.title || (chat.username ? `@${chat.username}` : String(chat.id));
    const typeLabel = chat.type === 'channel' ? 'ערוץ' : 'קבוצה';

    const text = [
      '🤖 <b>הבוט נוסף כמנהל (Admin) ל:</b>',
      `🏷️ ${fmt.esc(title)}`,
      `🆔 <code>${chat.id}</code>`,
      `סוג: ${typeLabel}`,
      '',
      'מה התפקיד של הצ\'אט הזה?',
    ].join('\n');

    if (!env.ADMIN_IDS.length) return;

    for (const adminId of env.ADMIN_IDS) {
      try {
        await ctx.telegram.sendMessage(adminId, text, {
          parse_mode: 'HTML',
          ...roleKeyboard(chat.id),
        });
      } catch (error) {
        console.warn(`[channels] failed to notify admin ${adminId}:`, error.message);
      }
    }
  }
}

/* --------------------------------- Actions --------------------------------- */

function register(bot) {
  bot.action('a:channels', async (ctx) => {
    if (!(await guard(ctx))) return false;
    await ctx.answerCbQuery();
    return showPanel(ctx);
  });

  bot.action(/^dst:set:(channel|admin_group):(-?\d+)$/, async (ctx) => {
    if (!(await guard(ctx))) return false;
    const role = ctx.match[1];
    const chatId = ctx.match[2];

    let chat = null;
    try {
      chat = await ctx.telegram.getChat(chatId);
    } catch (error) {
      /* לא קריטי — נשמור בלי כותרת/סוג */
    }

    try {
      await db.upsertDestination({
        chat_id: chatId,
        chat_title: chat ? chat.title || chat.username || null : null,
        chat_type: chat ? chat.type : null,
        role,
        added_by: ctx.from.id,
      });
    } catch (error) {
      await ctx.answerCbQuery('⚠️ שגיאה בשמירה', { show_alert: true });
      return ctx.reply(
        `⚠️ שמירת היעד נכשלה: ${fmt.esc(error.message)}\n\nייתכן שצריך להריץ קודם את src/db/schema_channels.sql ב-Supabase.`,
        { parse_mode: 'HTML' }
      );
    }

    await ctx.answerCbQuery('✅ נשמר');
    try {
      await ctx.editMessageText(`✅ הוגדר בהצלחה כ<b>${ROLE_LABELS[role]}</b>.`, { parse_mode: 'HTML' });
    } catch (error) {
      /* noop */
    }
    return true;
  });

  bot.action(/^dst:ignore:(-?\d+)$/, async (ctx) => {
    if (!(await guard(ctx))) return false;
    await ctx.answerCbQuery('בסדר, לא הוגדר');
    try {
      await ctx.editMessageText('🙈 לא הוגדר תפקיד לצ\'אט הזה.', { parse_mode: 'HTML' });
    } catch (error) {
      /* noop */
    }
    return true;
  });

  bot.action(/^dst:rm:(channel|admin_group):(-?\d+)$/, async (ctx) => {
    if (!(await guard(ctx))) return false;
    const role = ctx.match[1];
    const chatId = ctx.match[2];
    try {
      await db.removeDestination(chatId, role);
    } catch (error) {
      await ctx.answerCbQuery('⚠️ שגיאה בהסרה', { show_alert: true });
      return true;
    }
    await ctx.answerCbQuery('🗑️ הוסר');
    return showPanel(ctx);
  });
}

module.exports = {
  register,
  onMyChatMember,
  showPanel,
};
