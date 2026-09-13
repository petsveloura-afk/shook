'use strict';

/**
 * מקלדות רב-לשוניות (PRO).
 * מרחיב את keyboards.js ולא משנה אותו. כל ה-callbacks במרחב שמות נפרד:
 *   p:*  — משתמש   |   pa:* — אדמין
 */

const { Markup } = require('telegraf');
const env = require('../config/env');
const i18n = require('../i18n');
const taxonomy = require('../i18n/taxonomy');
const kb = require('./keyboards');

/* ------------------------------ תפריט ראשי ------------------------------ */

function mainMenu(lang) {
  const t = i18n.translator(lang);
  return Markup.keyboard([
    [t('menu.post')],
    [t('menu.search'), t('menu.browse')],
    [t('menu.mine'), t('menu.favorites')],
    [t('menu.alerts'), t('menu.settings')],
    [t('menu.channel'), t('menu.support')],
  ]).resize();
}

function cancelOnly(lang) {
  const t = i18n.translator(lang);
  return Markup.keyboard([[t('common.cancel')]]).resize();
}

function backRow(lang, callback = 'p:home') {
  const t = i18n.translator(lang);
  return [Markup.button.callback(t('common.back'), callback)];
}

/* -------------------------------- שפות -------------------------------- */

function languageKeyboard(current) {
  const rows = [];
  const locales = i18n.localeList();
  for (let i = 0; i < locales.length; i += 2) {
    rows.push(
      locales.slice(i, i + 2).map((locale) =>
        Markup.button.callback(
          `${locale.flag} ${locale.name}${locale.code === current ? ' ✅' : ''}`,
          `p:lang:${locale.code}`
        )
      )
    );
  }
  rows.push([Markup.button.callback(i18n.t(current, 'common.back'), 'p:set:menu')]);
  return Markup.inlineKeyboard(rows);
}

/* ------------------------------- הגדרות ------------------------------- */

function settingsKeyboard(user, lang) {
  const t = i18n.translator(lang);
  return Markup.inlineKeyboard([
    [Markup.button.callback(`${t('settings.language')}: ${i18n.localeName(lang)}`, 'p:set:lang')],
    [
      Markup.button.callback(
        user.notifications_enabled === false ? t('settings.notifOff') : t('settings.notifOn'),
        'p:set:notif'
      ),
    ],
    [Markup.button.callback(user.show_phone ? t('settings.privacyOn') : t('settings.privacyOff'), 'p:set:privacy')],
    [Markup.button.callback(t('settings.phone'), 'me:phone')],
    [Markup.button.callback(t('settings.profile'), 'p:me:profile')],
    [Markup.button.callback(t('common.mainMenu'), 'p:home')],
  ]);
}

/* -------------------------------- גלישה -------------------------------- */

function browseKeyboard(lang) {
  const t = i18n.translator(lang);
  return Markup.inlineKeyboard([
    [Markup.button.callback(t('browse.byCategory'), 'p:br:cat')],
    [
      Markup.button.callback(t('browse.trending'), 'p:feed:trending:0'),
      Markup.button.callback(t('browse.newest'), 'p:feed:newest:0'),
    ],
    [
      Markup.button.callback(t('browse.free'), 'p:feed:free:0'),
      Markup.button.callback(t('browse.deals'), 'p:feed:deals:0'),
    ],
    [
      Markup.button.callback(t('browse.nearby'), 'p:br:near'),
      Markup.button.callback(t('browse.topSellers'), 'p:br:top'),
    ],
    [Markup.button.callback(t('menu.search'), 's:menu')],
  ]);
}

function browseCategories(categories, counts, lang) {
  const t = i18n.translator(lang);
  const buttons = categories.map((category) =>
    Markup.button.callback(
      t('browse.categoryCount', {
        emoji: category.emoji,
        name: category.name_he,
        count: counts.get(category.id) || 0,
      }),
      `p:cat:${category.id}:0`
    )
  );
  const rows = [];
  for (let i = 0; i < buttons.length; i += 2) rows.push(buttons.slice(i, i + 2));
  rows.push(backRow(lang, 'p:br:menu'));
  return Markup.inlineKeyboard(rows);
}

function regionsFeedKeyboard(lang) {
  const buttons = taxonomy
    .regionOptions(i18n.normalize(lang) || i18n.DEFAULT_LANG)
    .map((region) => Markup.button.callback(`📍 ${region.label}`, `p:reg:${region.index}:0`));
  const rows = [];
  for (let i = 0; i < buttons.length; i += 2) rows.push(buttons.slice(i, i + 2));
  rows.push(backRow(lang, 'p:br:menu'));
  return Markup.inlineKeyboard(rows);
}

/* ----------------------------- כרטיס בפיד ----------------------------- */

/**
 * כפתורי כרטיס מודעה בפיד המורחב.
 * source מקודד את מקור הניווט: feed:<mode> | cat:<id> | reg:<idx> | sel:<userId>
 */
function feedCardKeyboard(listing, { page, total, isFav, lang, source }) {
  const t = i18n.translator(lang);
  const nav = [];
  if (page > 0) nav.push(Markup.button.callback(t('common.prev'), `p:go:${source}:${page - 1}`));
  if (page < total - 1) nav.push(Markup.button.callback(t('common.next'), `p:go:${source}:${page + 1}`));

  return Markup.inlineKeyboard([
    [
      Markup.button.callback(
        isFav ? '💔' : '⭐️',
        isFav ? `fav:del:${listing.id}` : `fav:add:${listing.id}`
      ),
      Markup.button.callback('📩', `ct:${listing.id}`),
      Markup.button.callback('🚩', `p:rep:${listing.id}`),
      Markup.button.url('📤', `https://t.me/share/url?url=${encodeURIComponent(env.botLink(`ad_${listing.id}`))}`),
    ],
    [
      Markup.button.callback(t('similar.title').replace(/<\/?b>/g, ''), `p:sim:${listing.id}`),
      Markup.button.callback(t('seller.title').replace(/<\/?b>/g, ''), `p:sel:${listing.user_id}:0`),
    ],
    ...(nav.length ? [nav] : []),
    [Markup.button.callback(t('menu.browse'), 'p:br:menu')],
  ]);
}

/* -------------------------------- דיווח -------------------------------- */

function reportKeyboard(listingId, lang) {
  const t = i18n.translator(lang);
  return Markup.inlineKeyboard([
    [Markup.button.callback(t('report.spam'), `p:rr:${listingId}:spam`)],
    [Markup.button.callback(t('report.fraud'), `p:rr:${listingId}:fraud`)],
    [Markup.button.callback(t('report.sold'), `p:rr:${listingId}:sold`)],
    [Markup.button.callback(t('report.forbidden'), `p:rr:${listingId}:forbidden`)],
    [Markup.button.callback(t('report.other'), `p:rr:${listingId}:other`)],
    [Markup.button.callback(t('common.cancel'), 'p:noop')],
  ]);
}

/* ------------------------------- התראות ------------------------------- */

function alertsKeyboard(searches, lang) {
  const t = i18n.translator(lang);
  const rows = searches.map((search, index) =>
    [Markup.button.callback(`🗑️ ${index + 1}`, `p:al:del:${search.id}`)]
  );
  const grouped = [];
  for (let i = 0; i < rows.length; i += 4) {
    grouped.push(rows.slice(i, i + 4).map((row) => row[0]));
  }
  return Markup.inlineKeyboard([
    [Markup.button.callback(t('alerts.create'), 'p:al:add')],
    ...grouped,
    [Markup.button.callback(t('menu.search'), 's:menu')],
    [Markup.button.callback(t('common.mainMenu'), 'p:home')],
  ]);
}

/* ----------------------------- פרופיל מוכר ----------------------------- */

function sellerKeyboard(sellerId, lang, { page = 0, total = 0 } = {}) {
  const t = i18n.translator(lang);
  const nav = [];
  if (page > 0) nav.push(Markup.button.callback(t('common.prev'), `p:sel:${sellerId}:${page - 1}`));
  if (page < total - 1) nav.push(Markup.button.callback(t('common.next'), `p:sel:${sellerId}:${page + 1}`));

  return Markup.inlineKeyboard([
    ...(nav.length ? [nav] : []),
    [Markup.button.callback(t('menu.browse'), 'p:br:menu')],
  ]);
}

/* ================================ אדמין ================================ */

function adminPanel(lang) {
  const t = i18n.translator(lang);
  return Markup.inlineKeyboard([
    [Markup.button.callback(t('admin.analytics'), 'pa:an')],
    [
      Markup.button.callback(t('admin.users'), 'pa:users'),
      Markup.button.callback(t('admin.reports'), 'pa:rep'),
    ],
    [
      Markup.button.callback(t('admin.bulk'), 'pa:bulk'),
      Markup.button.callback(t('admin.queue'), 'a:queue'),
    ],
    [
      Markup.button.callback(t('admin.featured'), 'pa:feat'),
      Markup.button.callback(t('admin.broadcast'), 'pa:seg'),
    ],
    [
      Markup.button.callback(t('admin.settings'), 'pa:set'),
      Markup.button.callback(t('admin.audit'), 'pa:audit'),
    ],
    [
      Markup.button.callback(t('admin.export'), 'pa:exp'),
      Markup.button.callback('🚫 Words', 'pa:words'),
    ],
    [Markup.button.callback('🛡️ Classic panel', 'a:panel')],
  ]);
}

function adminBack(lang) {
  const t = i18n.translator(lang);
  return Markup.inlineKeyboard([[Markup.button.callback(t('admin.back'), 'pa:panel')]]);
}

function adminUserKeyboard(user, lang) {
  const t = i18n.translator(lang);
  return Markup.inlineKeyboard([
    [
      Markup.button.callback(
        user.status === 'banned' ? '✅ Unban' : '🚫 Ban',
        `pa:u:${user.status === 'banned' ? 'unban' : 'ban'}:${user.id}`
      ),
      Markup.button.callback(user.is_verified ? '➖ Verified' : '✔️ Verify', `pa:u:verify:${user.id}`),
    ],
    [
      Markup.button.callback(user.is_vip ? '➖ VIP' : '💎 VIP', `pa:u:vip:${user.id}`),
      Markup.button.callback('✉️ Message', `pa:u:msg:${user.id}`),
    ],
    [Markup.button.callback('🛍️ Listings', `p:sel:${user.id}:0`)],
    [Markup.button.callback(t('admin.userSearch'), 'pa:users')],
    [Markup.button.callback(t('admin.back'), 'pa:panel')],
  ]);
}

function adminReportKeyboard(report, lang) {
  const t = i18n.translator(lang);
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('🗑️ Remove listing', `pa:r:${report.id}:remove`),
      Markup.button.callback('🚫 Ban seller', `pa:r:${report.id}:ban`),
    ],
    [
      Markup.button.callback('✅ Resolved', `pa:r:${report.id}:resolve`),
      Markup.button.callback('🙈 Dismiss', `pa:r:${report.id}:dismiss`),
    ],
    [Markup.button.callback(t('admin.reports'), 'pa:rep')],
    [Markup.button.callback(t('admin.back'), 'pa:panel')],
  ]);
}

function adminSettingsKeyboard(settings, lang) {
  const t = i18n.translator(lang);
  const on = (value) => (value === true || value === 'true' ? '🟢' : '🔴');
  return Markup.inlineKeyboard([
    [Markup.button.callback(`${on(settings.auto_approve)} Auto approve`, 'pa:s:auto_approve')],
    [Markup.button.callback(`${on(settings.maintenance_mode)} Maintenance`, 'pa:s:maintenance_mode')],
    [Markup.button.callback(`${on(settings.require_photo)} Require photo`, 'pa:s:require_photo')],
    [Markup.button.callback(`📊 Max ads/day: ${settings.max_ads_per_day}`, 'pa:sv:max_ads_per_day')],
    [Markup.button.callback(`🔔 Max alerts: ${settings.max_alerts}`, 'pa:sv:max_alerts')],
    [Markup.button.callback(`⏳ TTL days: ${settings.listing_ttl_days}`, 'pa:sv:listing_ttl_days')],
    [Markup.button.callback(t('admin.back'), 'pa:panel')],
  ]);
}

function adminExportKeyboard(lang) {
  const t = i18n.translator(lang);
  return Markup.inlineKeyboard([
    [Markup.button.callback('👥 users.csv', 'pa:exp:users')],
    [Markup.button.callback('🛍️ listings.csv', 'pa:exp:listings')],
    [Markup.button.callback(t('admin.back'), 'pa:panel')],
  ]);
}

function adminSegmentKeyboard(lang) {
  const t = i18n.translator(lang);
  const langRows = i18n
    .localeList()
    .map((locale) => Markup.button.callback(`${locale.flag} ${locale.name}`, `pa:seg:lang:${locale.code}`));
  const grouped = [];
  for (let i = 0; i < langRows.length; i += 3) grouped.push(langRows.slice(i, i + 3));

  return Markup.inlineKeyboard([
    [Markup.button.callback(t('admin.segAll'), 'pa:seg:all')],
    [Markup.button.callback(t('admin.segActive'), 'pa:seg:active')],
    [Markup.button.callback(t('admin.segSellers'), 'pa:seg:sellers')],
    ...grouped,
    [Markup.button.callback(t('admin.back'), 'pa:panel')],
  ]);
}

function adminFeaturedKeyboard(listingId, lang) {
  const t = i18n.translator(lang);
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('💎 3d', `pa:feat:${listingId}:3`),
      Markup.button.callback('💎 7d', `pa:feat:${listingId}:7`),
      Markup.button.callback('💎 30d', `pa:feat:${listingId}:30`),
    ],
    [Markup.button.callback('➖ Remove', `pa:feat:${listingId}:0`)],
    [Markup.button.callback(t('admin.back'), 'pa:panel')],
  ]);
}

function adminWordsKeyboard(words, lang) {
  const t = i18n.translator(lang);
  const rows = words.slice(0, 20).map((entry) => [
    Markup.button.callback(`🗑️ ${entry.word}`, `pa:w:del:${entry.id}`),
  ]);
  return Markup.inlineKeyboard([
    [Markup.button.callback('➕ Add word', 'pa:w:add')],
    ...rows,
    [Markup.button.callback(t('admin.back'), 'pa:panel')],
  ]);
}

module.exports = {
  mainMenu,
  cancelOnly,
  backRow,
  languageKeyboard,
  settingsKeyboard,
  browseKeyboard,
  browseCategories,
  regionsFeedKeyboard,
  feedCardKeyboard,
  reportKeyboard,
  alertsKeyboard,
  sellerKeyboard,

  adminPanel,
  adminBack,
  adminUserKeyboard,
  adminReportKeyboard,
  adminSettingsKeyboard,
  adminExportKeyboard,
  adminSegmentKeyboard,
  adminFeaturedKeyboard,
  adminWordsKeyboard,
};
