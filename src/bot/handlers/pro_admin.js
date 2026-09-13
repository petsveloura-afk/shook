'use strict';

/**
 * מרכז הבקרה המורחב (PRO ADMIN).
 * נוסף על handlers/admin.js הקיים — הפאנל הישן ממשיך לעבוד כרגיל ('a:*'),
 * והחדש חי במרחב השמות 'pa:*'.
 */

const env = require('../../config/env');
const db = require('../../db/supabase');
const extra = require('../../db/extra');
const i18n = require('../../i18n');
const kb = require('../keyboards');
const kbp = require('../keyboards_pro');
const fmt = require('../formatters');
const fmtPro = require('../formatters_pro');
const publish = require('../publish');
const alerts = require('../../services/alerts');
const proUser = require('./pro_user');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* --------------------------------- עזרים --------------------------------- */

function isAdmin(ctx) {
  return Boolean(ctx.from && env.isAdmin(ctx.from.id));
}

async function guard(ctx) {
  if (isAdmin(ctx)) return true;
  const t = ctx.t || i18n.translator('he');
  if (ctx.callbackQuery) await ctx.answerCbQuery(t('common.noPermission'), { show_alert: true });
  else await ctx.reply(t('common.noPermission'));
  return false;
}

function adminName(ctx) {
  return ctx.from.username
    ? `@${ctx.from.username}`
    : [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' ');
}

async function audit(ctx, action, targetType, targetId, details) {
  return extra.logAudit({
    adminId: ctx.from.id,
    adminName: adminName(ctx),
    action,
    targetType,
    targetId,
    details: details || {},
  });
}

function langOf(ctx) {
  return ctx.lang || i18n.DEFAULT_LANG;
}

async function render(ctx, text, keyboard, { edit = true } = {}) {
  const options = { parse_mode: 'HTML', disable_web_page_preview: true, ...keyboard };
  if (edit && ctx.callbackQuery) {
    try {
      return await ctx.editMessageText(text, options);
    } catch (error) {
      /* ההודעה זהה או לא ניתנת לעריכה */
    }
  }
  return ctx.reply(text, options);
}

/* --------------------------------- פאנל --------------------------------- */

async function showPanel(ctx, { edit = true } = {}) {
  const lang = langOf(ctx);
  const snapshot = await extra.analyticsSnapshot();
  const m = snapshot.metrics;

  const text = [
    i18n.t(lang, 'admin.title'),
    fmtPro.DIVIDER,
    `👥 ${fmtPro.n(m.totalUsers)} users · +${fmtPro.n(snapshot.users7)} (7d)`,
    `🛍️ ${fmtPro.n(m.approved)} live · ⏳ ${fmtPro.n(m.pending)} pending · 🏷️ ${fmtPro.n(m.sold)} sold`,
    `🚩 ${fmtPro.n(snapshot.reportsOpen)} open reports · ✅ ${snapshot.approvalRate}% approval`,
    `🌐 ${snapshot.languages
      .slice(0, 4)
      .map((row) => `${i18n.LOCALES[row.lang] ? i18n.LOCALES[row.lang]['locale.flag'] : '🏳️'}${row.count}`)
      .join(' ')}`,
    '',
    `🕐 ${fmt.formatDateTime(new Date())}`,
  ].join('\n');

  return render(ctx, text, kbp.adminPanel(lang), { edit });
}

async function showAnalytics(ctx) {
  const lang = langOf(ctx);
  const [snapshot, series] = await Promise.all([
    extra.analyticsSnapshot(),
    extra.dailySeries('listings', 'created_at', 7),
  ]);
  return render(ctx, fmtPro.analyticsReport(snapshot, series, lang), kbp.adminBack(lang));
}

/* ---------------------------- ניהול משתמשים ---------------------------- */

async function showUserCard(ctx, user) {
  const lang = langOf(ctx);
  const stats = await proUser.userStats(user.id);
  return render(ctx, fmtPro.adminUserCard(user, stats, lang), kbp.adminUserKeyboard(user, lang), {
    edit: false,
  });
}

/* -------------------------------- דיווחים -------------------------------- */

async function showReports(ctx) {
  const lang = langOf(ctx);
  const reports = await extra.listOpenReports(1);

  if (!reports.length) {
    return render(ctx, i18n.t(lang, 'admin.noReports'), kbp.adminBack(lang));
  }

  const report = reports[0];
  return render(ctx, fmtPro.reportCard(report, lang), kbp.adminReportKeyboard(report, lang));
}

/* ------------------------------- הגדרות ------------------------------- */

async function showSettings(ctx) {
  const lang = langOf(ctx);
  const settings = await extra.getSettings();
  return render(ctx, fmtPro.settingsAdminCard(settings, lang), kbp.adminSettingsKeyboard(settings, lang));
}

async function showWords(ctx) {
  const lang = langOf(ctx);
  const words = await extra.listBlockedWords();
  return render(ctx, fmtPro.blockedWordsCard(words, lang), kbp.adminWordsKeyboard(words, lang));
}

async function showAudit(ctx) {
  const lang = langOf(ctx);
  const rows = await extra.listAudit(15);
  return render(ctx, fmtPro.auditCard(rows, lang), kbp.adminBack(lang));
}

/* ------------------------------ אישור מרוכז ------------------------------ */

async function bulkApprove(ctx) {
  const lang = langOf(ctx);
  const pending = await db.listPendingListings(20);

  if (!pending.length) {
    return render(ctx, '✅ ' + i18n.t(lang, 'admin.noReports'), kbp.adminBack(lang));
  }

  let approved = 0;
  let failed = 0;

  for (const listing of pending) {
    try {
      const published = await publish.publishListing(ctx.telegram, listing.id);
      approved += 1;

      try {
        await alerts.notifyMatches(ctx.telegram, published);
      } catch (error) {
        console.warn('[pro_admin] alerts failed:', error.message);
      }

      const seller = published.seller;
      if (seller && seller.telegram_id) {
        const sellerLang = i18n.normalize(seller.language) || i18n.DEFAULT_LANG;
        try {
          await ctx.telegram.sendMessage(
            seller.telegram_id,
            `🎉 <b>${fmt.esc(published.title)}</b>\n${i18n.t(sellerLang, 'common.saved')} ✅`,
            { parse_mode: 'HTML' }
          );
        } catch (error) {
          /* המשתמש חסם את הבוט */
        }
      }
    } catch (error) {
      console.error('[pro_admin] bulk publish failed:', error.message);
      failed += 1;
    }
    await sleep(400);
  }

  await audit(ctx, 'bulk_approve', 'listings', null, { approved, failed });
  return render(
    ctx,
    `${i18n.t(lang, 'admin.bulkDone', { count: approved })}${failed ? ` · ❌ ${failed}` : ''}`,
    kbp.adminBack(lang),
    { edit: false }
  );
}

/* -------------------------------- שידור -------------------------------- */

async function runSegmentedBroadcast(ctx, segment, message) {
  const lang = langOf(ctx);
  const ids = await extra.segmentTelegramIds(segment);
  const startedAt = Date.now();
  const deadline = 50000;

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  const progress = await ctx.reply(`📢 ${segment} → ${fmtPro.n(ids.length)} ...`);

  for (let i = 0; i < ids.length; i += 1) {
    if (Date.now() - startedAt > deadline) {
      skipped = ids.length - i;
      break;
    }
    try {
      await ctx.telegram.sendMessage(ids[i], message, {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      });
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
          `📢 ${fmtPro.n(sent)}/${fmtPro.n(ids.length)}`
        );
      } catch (error) {
        /* noop */
      }
    }
  }

  await db.logBroadcast({ adminId: ctx.from.id, message, sentCount: sent, failedCount: failed });
  await audit(ctx, 'broadcast', 'segment', segment, { sent, failed, skipped });

  return render(
    ctx,
    [
      '📢 <b>Broadcast summary</b>',
      fmtPro.DIVIDER,
      `🎯 Segment: <code>${fmt.esc(segment)}</code>`,
      `✅ Sent: ${fmtPro.n(sent)}`,
      `❌ Failed: ${fmtPro.n(failed)}`,
      skipped ? `⏭️ Skipped (time limit): ${fmtPro.n(skipped)}` : null,
    ]
      .filter((line) => line !== null && line !== undefined)
      .join('\n'),
    kbp.adminBack(lang),
    { edit: false }
  );
}

/* ------------------------------ ראוטר טקסט ------------------------------ */

async function onText(ctx) {
  if (!isAdmin(ctx)) {
    delete ctx.session.state;
    return false;
  }

  const lang = langOf(ctx);
  const t = ctx.t || i18n.translator(lang);
  const text = (ctx.message.text || '').trim();
  const state = ctx.session.state || '';

  if (text === t('common.cancel') || text === kb.CANCEL) {
    delete ctx.session.state;
    delete ctx.session.pro;
    return ctx.reply(t('common.cancel'), kbp.mainMenu(lang));
  }

  /* חיפוש משתמש */
  if (state === 'pro:userSearch') {
    delete ctx.session.state;
    const user = await extra.findUser(text);
    if (!user) return ctx.reply(t('common.notFound'), { parse_mode: 'HTML' });
    return showUserCard(ctx, user);
  }

  /* הודעה ישירה למשתמש */
  const msgMatch = state.match(/^pro:msg:(\d+)$/);
  if (msgMatch) {
    delete ctx.session.state;
    const user = await db.getUserById(Number(msgMatch[1]));
    if (!user) return ctx.reply(t('common.notFound'));
    try {
      await ctx.telegram.sendMessage(user.telegram_id, `📩 <b>הודעה מצוות הניהול</b>\n\n${text}`, {
        parse_mode: 'HTML',
      });
      await audit(ctx, 'dm_user', 'user', user.id, { length: text.length });
      return ctx.reply('✅ ' + t('common.saved'), kbp.adminBack(lang));
    } catch (error) {
      return ctx.reply(`❌ ${fmt.esc(error.message)}`, { parse_mode: 'HTML' });
    }
  }

  /* הגדרת ערך מספרי */
  const settingMatch = state.match(/^pro:setting:([a-z_]+)$/);
  if (settingMatch) {
    const key = settingMatch[1];
    const value = Number(text.replace(/\D/g, ''));
    if (!Number.isFinite(value) || value <= 0) return ctx.reply('⚠️ 1-999');
    delete ctx.session.state;
    await extra.setSetting(key, value, ctx.from.id);
    await audit(ctx, 'setting_update', 'setting', key, { value });
    await ctx.reply(t('admin.settingUpdated'));
    return showSettings(ctx);
  }

  /* הוספת מילה חסומה */
  if (state === 'pro:word') {
    delete ctx.session.state;
    const [word, severity] = text.split('|').map((part) => part.trim());
    await extra.addBlockedWord(word, severity === 'flag' ? 'flag' : 'block', ctx.from.id);
    await audit(ctx, 'blocked_word_add', 'word', word, { severity: severity || 'block' });
    return showWords(ctx);
  }

  /* קידום מודעה */
  if (state === 'pro:featured') {
    delete ctx.session.state;
    const id = Number((text.match(/(\d+)/) || [])[1]);
    const listing = id ? await db.getListing(id) : null;
    if (!listing) return ctx.reply(t('common.notFound'));
    return ctx.reply(
      `💎 <b>${fmt.esc(listing.title)}</b>\n<code>${fmt.adId(listing.id)}</code>`,
      { parse_mode: 'HTML', ...kbp.adminFeaturedKeyboard(listing.id, lang) }
    );
  }

  /* שידור מפולח — קליטת תוכן ההודעה */
  if (state.startsWith('pro:bc:')) {
    const segment = state.slice('pro:bc:'.length);
    delete ctx.session.state;
    ctx.session.pro = { broadcast: text, segment };
    return ctx.reply(
      ['📢 <b>Preview</b>', fmtPro.DIVIDER, text, fmtPro.DIVIDER, `🎯 <code>${fmt.esc(segment)}</code>`].join('\n'),
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: '📢 Send now', callback_data: 'pa:bcgo' }],
            [{ text: t('common.cancel'), callback_data: 'pa:bcx' }],
          ],
        },
      }
    );
  }

  delete ctx.session.state;
  return false;
}

/* -------------------------------- Actions -------------------------------- */

function register(bot) {
  bot.command('panel', async (ctx) => {
    if (!(await guard(ctx))) return false;
    return showPanel(ctx, { edit: false });
  });

  bot.command('analytics', async (ctx) => {
    if (!(await guard(ctx))) return false;
    return showAnalytics(ctx);
  });

  bot.action('pa:panel', async (ctx) => {
    if (!(await guard(ctx))) return false;
    await ctx.answerCbQuery();
    return showPanel(ctx);
  });

  bot.action('pa:an', async (ctx) => {
    if (!(await guard(ctx))) return false;
    await ctx.answerCbQuery('📈');
    return showAnalytics(ctx);
  });

  /* ---------- משתמשים ---------- */
  bot.action('pa:users', async (ctx) => {
    if (!(await guard(ctx))) return false;
    await ctx.answerCbQuery();
    ctx.session.state = 'pro:userSearch';
    return ctx.reply('🔎 Telegram ID / DB id / @username:', kbp.cancelOnly(langOf(ctx)));
  });

  bot.action(/^pa:u:(ban|unban|verify|vip|msg):(\d+)$/, async (ctx) => {
    if (!(await guard(ctx))) return false;
    const action = ctx.match[1];
    const userId = Number(ctx.match[2]);
    const user = await db.getUserById(userId);
    if (!user) return ctx.answerCbQuery('❌', { show_alert: true });

    if (action === 'msg') {
      await ctx.answerCbQuery();
      ctx.session.state = `pro:msg:${userId}`;
      return ctx.reply('✉️ ' + fmt.esc(user.full_name) + ':', kbp.cancelOnly(langOf(ctx)));
    }

    if (action === 'ban' || action === 'unban') {
      await db.setUserStatus(user.id, action === 'ban' ? 'banned' : 'active', action === 'ban' ? 'admin action' : null);
      await audit(ctx, action, 'user', user.id, {});
      const sellerLang = i18n.normalize(user.language) || i18n.DEFAULT_LANG;
      try {
        await ctx.telegram.sendMessage(
          user.telegram_id,
          action === 'ban' ? i18n.t(sellerLang, 'spam.banned') : '✅',
          { parse_mode: 'HTML' }
        );
      } catch (error) {
        /* noop */
      }
    }

    if (action === 'verify') {
      await extra.setVerified(user.id, !user.is_verified);
      await audit(ctx, 'verify_toggle', 'user', user.id, { value: !user.is_verified });
    }

    if (action === 'vip') {
      await extra.setVip(user.id, !user.is_vip);
      await audit(ctx, 'vip_toggle', 'user', user.id, { value: !user.is_vip });
    }

    const fresh = await db.getUserById(userId);
    await ctx.answerCbQuery('✅');
    await ctx.deleteMessage().catch(() => {});
    return showUserCard(ctx, fresh);
  });

  /* ---------- דיווחים ---------- */
  bot.action('pa:rep', async (ctx) => {
    if (!(await guard(ctx))) return false;
    await ctx.answerCbQuery();
    return showReports(ctx);
  });

  bot.action(/^pa:r:(\d+):(remove|ban|resolve|dismiss)$/, async (ctx) => {
    if (!(await guard(ctx))) return false;
    const reportId = Number(ctx.match[1]);
    const action = ctx.match[2];

    const reports = await extra.listOpenReports(50);
    const report = reports.find((row) => Number(row.id) === reportId);
    if (!report) {
      await ctx.answerCbQuery('❌');
      return showReports(ctx);
    }

    const listing = report.listing ? await db.getListing(report.listing.id) : null;

    if (action === 'remove' && listing) {
      await publish.removeFromChannel(ctx.telegram, listing);
      await db.updateListing(listing.id, {
        status: 'deleted',
        channel_message_id: null,
        channel_media_message_ids: [],
      });
      await audit(ctx, 'report_remove_listing', 'listing', listing.id, { reason: report.reason });
    }

    if (action === 'ban' && listing) {
      await db.setUserStatus(listing.user_id, 'banned', `report:${report.reason}`);
      await publish.removeFromChannel(ctx.telegram, listing);
      await db.updateListing(listing.id, { status: 'deleted' });
      await audit(ctx, 'report_ban_seller', 'user', listing.user_id, { listing: listing.id });
    }

    await extra.resolveReport(reportId, action === 'dismiss' ? 'dismissed' : 'resolved', ctx.from.id);
    await ctx.answerCbQuery('✅');
    return showReports(ctx);
  });

  /* ---------- הגדרות ---------- */
  bot.action('pa:set', async (ctx) => {
    if (!(await guard(ctx))) return false;
    await ctx.answerCbQuery();
    return showSettings(ctx);
  });

  bot.action(/^pa:s:([a-z_]+)$/, async (ctx) => {
    if (!(await guard(ctx))) return false;
    const key = ctx.match[1];
    const settings = await extra.getSettings();
    const current = settings[key] === true || settings[key] === 'true';
    await extra.setSetting(key, !current, ctx.from.id);
    await audit(ctx, 'setting_toggle', 'setting', key, { value: !current });
    await ctx.answerCbQuery(!current ? '🟢 ON' : '🔴 OFF');
    return showSettings(ctx);
  });

  bot.action(/^pa:sv:([a-z_]+)$/, async (ctx) => {
    if (!(await guard(ctx))) return false;
    await ctx.answerCbQuery();
    ctx.session.state = `pro:setting:${ctx.match[1]}`;
    return ctx.reply(`🔢 ${ctx.match[1]}:`, kbp.cancelOnly(langOf(ctx)));
  });

  /* ---------- מילים חסומות ---------- */
  bot.action('pa:words', async (ctx) => {
    if (!(await guard(ctx))) return false;
    await ctx.answerCbQuery();
    return showWords(ctx);
  });

  bot.action('pa:w:add', async (ctx) => {
    if (!(await guard(ctx))) return false;
    await ctx.answerCbQuery();
    ctx.session.state = 'pro:word';
    return ctx.reply('➕ <code>word</code> או <code>word|flag</code>:', {
      parse_mode: 'HTML',
      ...kbp.cancelOnly(langOf(ctx)),
    });
  });

  bot.action(/^pa:w:del:(\d+)$/, async (ctx) => {
    if (!(await guard(ctx))) return false;
    await extra.deleteBlockedWord(Number(ctx.match[1]));
    await audit(ctx, 'blocked_word_delete', 'word', ctx.match[1], {});
    await ctx.answerCbQuery('🗑️');
    return showWords(ctx);
  });

  /* ---------- יומן ---------- */
  bot.action('pa:audit', async (ctx) => {
    if (!(await guard(ctx))) return false;
    await ctx.answerCbQuery();
    return showAudit(ctx);
  });

  /* ---------- אישור מרוכז ---------- */
  bot.action('pa:bulk', async (ctx) => {
    if (!(await guard(ctx))) return false;
    await ctx.answerCbQuery('⚡');
    return bulkApprove(ctx);
  });

  /* ---------- קידום מודעות ---------- */
  bot.action('pa:feat', async (ctx) => {
    if (!(await guard(ctx))) return false;
    await ctx.answerCbQuery();
    ctx.session.state = 'pro:featured';
    return ctx.reply('💎 ID:', kbp.cancelOnly(langOf(ctx)));
  });

  bot.action(/^pa:feat:(\d+):(\d+)$/, async (ctx) => {
    if (!(await guard(ctx))) return false;
    const listingId = Number(ctx.match[1]);
    const days = Number(ctx.match[2]);
    await extra.setFeatured(listingId, days);
    await audit(ctx, 'feature_listing', 'listing', listingId, { days });
    await ctx.answerCbQuery('💎');
    return render(
      ctx,
      i18n.t(langOf(ctx), 'admin.featuredDone', { days }),
      kbp.adminBack(langOf(ctx)),
      { edit: false }
    );
  });

  /* ---------- ייצוא ---------- */
  bot.action('pa:exp', async (ctx) => {
    if (!(await guard(ctx))) return false;
    await ctx.answerCbQuery();
    return render(ctx, '📤 CSV export', kbp.adminExportKeyboard(langOf(ctx)));
  });

  bot.action(/^pa:exp:(users|listings)$/, async (ctx) => {
    if (!(await guard(ctx))) return false;
    await ctx.answerCbQuery('📤');
    const type = ctx.match[1];
    const csv = type === 'users' ? await extra.exportUsersCsv() : await extra.exportListingsCsv();
    const filename = `pashpashuk-${type}-${new Date().toISOString().slice(0, 10)}.csv`;

    await audit(ctx, 'export', type, null, { bytes: csv.length });
    return ctx.replyWithDocument(
      { source: Buffer.from(csv, 'utf8'), filename },
      { caption: i18n.t(langOf(ctx), 'admin.exported') }
    );
  });

  /* ---------- שידור מפולח ---------- */
  bot.action('pa:seg', async (ctx) => {
    if (!(await guard(ctx))) return false;
    await ctx.answerCbQuery();
    return render(ctx, i18n.t(langOf(ctx), 'admin.segment'), kbp.adminSegmentKeyboard(langOf(ctx)));
  });

  bot.action(/^pa:seg:(all|active|sellers)$/, async (ctx) => {
    if (!(await guard(ctx))) return false;
    await ctx.answerCbQuery();
    ctx.session.state = `pro:bc:${ctx.match[1]}`;
    return ctx.reply('📢 HTML message:', kbp.cancelOnly(langOf(ctx)));
  });

  bot.action(/^pa:seg:lang:([a-z]{2})$/, async (ctx) => {
    if (!(await guard(ctx))) return false;
    await ctx.answerCbQuery();
    ctx.session.state = `pro:bc:lang:${ctx.match[1]}`;
    return ctx.reply(`📢 ${i18n.localeName(ctx.match[1])}:`, kbp.cancelOnly(langOf(ctx)));
  });

  bot.action('pa:bcgo', async (ctx) => {
    if (!(await guard(ctx))) return false;
    const payload = ctx.session.pro;
    if (!payload || !payload.broadcast) return ctx.answerCbQuery('❌', { show_alert: true });
    await ctx.answerCbQuery('📢');
    delete ctx.session.pro;
    try {
      await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
    } catch (error) {
      /* noop */
    }
    return runSegmentedBroadcast(ctx, payload.segment, payload.broadcast);
  });

  bot.action('pa:bcx', async (ctx) => {
    if (!(await guard(ctx))) return false;
    delete ctx.session.pro;
    delete ctx.session.state;
    await ctx.answerCbQuery('❌');
    return showPanel(ctx, { edit: false });
  });
}

module.exports = {
  register,
  onText,
  showPanel,
  showAnalytics,
  showReports,
  showSettings,
  showUserCard,
  bulkApprove,
  isAdmin,
  audit,
};
