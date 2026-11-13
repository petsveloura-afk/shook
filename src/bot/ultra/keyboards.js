'use strict';

/**
 * ULTRA — מקלדות inline מעוצבות (תוספת בלבד).
 * מרחב שמות callbacks: u:* (משתמש) ו-ux:* (אדמין). אין חפיפה עם הקיימים.
 */

const { Markup } = require('telegraf');
const env = require('../../config/env');
const { ut } = require('../../i18n/ultra');
const { chunk, esc } = require('./theme');

function supportUrl() {
  return env.SUPPORT_USERNAME ? `https://t.me/${String(env.SUPPORT_USERNAME).replace(/^@/, '')}` : null;
}

/** מרכז הבית — מסך ראשי בסגנון דאשבורד. */
function hub(lang) {
  const t = (key) => ut(lang, key);
  const rows = [
    [Markup.button.callback(t('b.post'), 'm:new')],
    [Markup.button.callback(t('b.search'), 's:menu'), Markup.button.callback(t('b.browse'), 'p:br:menu')],
    [Markup.button.callback(t('b.trending'), 'p:feed:trending:0'), Markup.button.callback(t('b.newest'), 'p:feed:newest:0')],
    [Markup.button.callback(t('b.free'), 'p:feed:free:0'), Markup.button.callback(t('b.deals'), 'p:feed:deals:0')],
    [Markup.button.callback(t('b.mine'), 'my:0'), Markup.button.callback(t('b.favs'), 'fv:0')],
    [Markup.button.callback(t('b.alerts'), 'p:al:menu'), Markup.button.callback(t('b.tools'), 'u:tools')],
    [Markup.button.callback(t('b.guide'), 'u:guide'), Markup.button.callback(t('b.settings'), 'p:set:menu')],
  ];

  const links = [];
  if (env.CHANNEL_URL) links.push(Markup.button.url(t('b.channel'), env.CHANNEL_URL));
  const support = supportUrl();
  if (support) links.push(Markup.button.url(t('b.support'), support));
  if (links.length) rows.push(links);

  return Markup.inlineKeyboard(rows);
}

/** תפריט הכלים החכמים. */
function tools(lang) {
  const t = (key) => ut(lang, key);
  return Markup.inlineKeyboard([
    [Markup.button.callback(t('tools.price'), 'u:price')],
    [Markup.button.callback(t('tools.score'), 'u:score')],
    [Markup.button.callback(t('tools.safety'), 'u:safe'), Markup.button.callback(t('tools.tips'), 'u:tip:0')],
    [Markup.button.callback(t('b.hub'), 'u:hub')],
  ]);
}

/** רשת קטגוריות ליועץ המחירים. */
function priceCategories(categories, lang) {
  const buttons = categories.map((category) =>
    Markup.button.callback(`${category.emoji} ${category.name_he}`, `u:pc:${category.id}`)
  );
  return Markup.inlineKeyboard([
    ...chunk(buttons, 2),
    [Markup.button.callback(ut(lang, 'b.back'), 'u:tools'), Markup.button.callback(ut(lang, 'b.hub'), 'u:hub')],
  ]);
}

function priceResult(lang) {
  return Markup.inlineKeyboard([
    [Markup.button.callback(ut(lang, 'tools.price'), 'u:price')],
    [Markup.button.callback(ut(lang, 'b.back'), 'u:tools'), Markup.button.callback(ut(lang, 'b.hub'), 'u:hub')],
  ]);
}

const STATUS_EMOJI = { approved: '🟢', pending: '⏳', sold: '🏷️', rejected: '🚫' };

/** רשימת מודעות של המשתמש לבחירה (ציון איכות). */
function scoreList(listings, lang) {
  const rows = listings.map((listing) => {
    const title = String(listing.title || '').trim();
    const short = title.length > 28 ? `${title.slice(0, 27)}…` : title;
    return [Markup.button.callback(`${STATUS_EMOJI[listing.status] || '📋'} ${short}`, `u:sc:${listing.id}`)];
  });
  rows.push([
    Markup.button.callback(ut(lang, 'b.back'), 'u:tools'),
    Markup.button.callback(ut(lang, 'b.hub'), 'u:hub'),
  ]);
  return Markup.inlineKeyboard(rows);
}

function scoreDetail(listing, lang) {
  const rows = [];
  if (listing && listing.status === 'approved') {
    rows.push([Markup.button.callback('🔄⬆️', `my:bump:${listing.id}`)]);
  }
  rows.push([Markup.button.callback(ut(lang, 'tools.price'), 'u:price'), Markup.button.callback(ut(lang, 'tools.score'), 'u:score')]);
  rows.push([Markup.button.callback(ut(lang, 'b.back'), 'u:tools'), Markup.button.callback(ut(lang, 'b.hub'), 'u:hub')]);
  return Markup.inlineKeyboard(rows);
}

function tipKeyboard(lang, next) {
  return Markup.inlineKeyboard([
    [Markup.button.callback(ut(lang, 'tips.next'), `u:tip:${next}`)],
    [Markup.button.callback(ut(lang, 'b.back'), 'u:tools'), Markup.button.callback(ut(lang, 'b.hub'), 'u:hub')],
  ]);
}

function guideKeyboard(lang) {
  return Markup.inlineKeyboard([
    [Markup.button.callback(ut(lang, 'b.post'), 'm:new')],
    [Markup.button.callback(ut(lang, 'tools.tips'), 'u:tip:0'), Markup.button.callback(ut(lang, 'tools.price'), 'u:price')],
    [Markup.button.callback(ut(lang, 'b.hub'), 'u:hub')],
  ]);
}

/**
 * מסך "אין תוצאות" חכם.
 * options: [{ key, total, code }]  code ∈ price|region|cat — הקלה על הסינון
 */
function emptyResult(lang, { options = [], category = null, canAlert = false } = {}) {
  const rows = options.map((option) => [
    Markup.button.callback(`${ut(lang, option.key)} (${option.total})`, `u:alt:${option.code}`),
  ]);
  if (category) {
    rows.push([Markup.button.callback(`🗂️ ${category.emoji} ${esc(category.name_he)}`, `p:cat:${category.id}:0`)]);
  }
  if (canAlert) rows.push([Markup.button.callback(ut(lang, 'smart.alert'), 'p:al:add')]);
  rows.push([Markup.button.callback(ut(lang, 'b.search'), 's:menu'), Markup.button.callback(ut(lang, 'b.hub'), 'u:hub')]);
  return Markup.inlineKeyboard(rows);
}

/* ------------------------------- אדמין ------------------------------- */

function adminHealth(lang) {
  return Markup.inlineKeyboard([
    [Markup.button.callback(ut(lang, 'b.refresh'), 'ux:health'), Markup.button.callback('📅 Digest', 'ux:digest')],
    [Markup.button.callback('🛡️ Panel', 'pa:panel')],
  ]);
}

function adminDigest(lang) {
  return Markup.inlineKeyboard([
    [Markup.button.callback(ut(lang, 'b.refresh'), 'ux:digest'), Markup.button.callback('🩺 Health', 'ux:health')],
    [Markup.button.callback('🛡️ Panel', 'pa:panel')],
  ]);
}

module.exports = {
  hub,
  tools,
  priceCategories,
  priceResult,
  scoreList,
  scoreDetail,
  tipKeyboard,
  guideKeyboard,
  emptyResult,
  adminHealth,
  adminDigest,
  supportUrl,
};
