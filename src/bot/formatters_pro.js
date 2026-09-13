'use strict';

/**
 * שכבת עיצוב מתקדמת ורב-לשונית (PRO).
 * לא מחליפה את formatters.js — משתמשת בו ומרחיבה אותו.
 */

const fmt = require('./formatters');
const i18n = require('../i18n');
const taxonomy = require('../i18n/taxonomy');
const kb = require('./keyboards');

const DIVIDER = '━━━━━━━━━━━━━━━';
const SOFT_DIVIDER = '┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈';

/* --------------------------------- עזרים --------------------------------- */

function esc(value) {
  return fmt.esc(value);
}

function n(value) {
  return fmt.formatNumber(value);
}

/** כוכבים ויזואליים לפי ממוצע דירוג. */
function stars(average) {
  const value = Math.max(0, Math.min(5, Number(average) || 0));
  const full = Math.floor(value);
  const half = value - full >= 0.5 ? 1 : 0;
  return '⭐'.repeat(full) + (half ? '✨' : '') + '▫️'.repeat(Math.max(0, 5 - full - half));
}

function ratingOf(user) {
  if (!user || !Number(user.rating_count)) return null;
  return Number(user.rating_sum) / Number(user.rating_count);
}

/** בר התקדמות טקסטואלי (לגרפים בתוך טלגרם). */
function bar(value, max, width = 12) {
  const safeMax = Math.max(Number(max) || 0, 1);
  const filled = Math.round((Math.max(Number(value) || 0, 0) / safeMax) * width);
  return '█'.repeat(Math.min(filled, width)) + '░'.repeat(Math.max(0, width - filled));
}

/** גרף עמודות אופקי לסדרה יומית. */
function sparkChart(series, { width = 10 } = {}) {
  if (!series || !series.length) return '';
  const max = Math.max(...series.map((point) => point.value), 1);
  return series
    .map((point) => {
      const day = point.day.slice(5).replace('-', '/');
      return `<code>${day}</code> ${bar(point.value, max, width)} ${n(point.value)}`;
    })
    .join('\n');
}

function priceText(listing, t) {
  if (!listing) return '';
  if (listing.price_type === 'free') return t('card.free');
  const amount = `₪${n(Math.round(Number(listing.price || 0)))}`;
  if (listing.price_type === 'flexible') return `${amount} · ${t('card.negotiable')}`;
  return amount;
}

function conditionText(listing, lang) {
  return taxonomy.conditionLabel(listing.condition, i18n.normalize(lang) || i18n.DEFAULT_LANG);
}

function locationText(listing, lang) {
  return taxonomy.regionLabel(listing.location || '', i18n.normalize(lang) || i18n.DEFAULT_LANG);
}

function badges(user, t) {
  const list = [];
  if (user.is_verified) list.push(t('seller.badgeVerified'));
  if (user.is_vip) list.push(t('seller.badgeVip'));
  const average = ratingOf(user);
  if (average && average >= 4.5 && Number(user.rating_count) >= 5) list.push(t('seller.badgeTop'));
  if (!Number(user.rating_count)) list.push(t('seller.badgeNew'));
  return list.join(' · ');
}

function relativeAge(value, lang) {
  const created = value ? new Date(value).getTime() : Date.now();
  const hours = Math.max(0, Math.round((Date.now() - created) / 3600000));
  if (hours < 1) return { he: 'לפני רגע', en: 'just now', ar: 'الآن', ru: 'только что', fr: "à l'instant", es: 'ahora', uk: 'щойно' }[lang] || 'now';
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

/* ------------------------------ כרטיס מודעה ------------------------------ */

function listingCard(listing, lang, { page = null, total = null, showSeller = true } = {}) {
  const t = i18n.translator(lang);
  const seller = listing.seller || {};
  const average = ratingOf(seller);

  const lines = [];

  if (listing.is_featured) lines.push(`${t('card.featured')}`);
  if (listing.status === 'sold') lines.push(`${t('card.sold')} ✖️`);

  lines.push(`🔥 <b>${esc(listing.title)}</b>`);
  lines.push(SOFT_DIVIDER);
  lines.push(`${t('card.price')}: <b>${priceText(listing, t)}</b>`);
  lines.push(`${t('card.condition')}: ${esc(conditionText(listing, lang))}`);
  lines.push(
    `${t('card.category')}: ${esc(listing.category ? `${listing.category.name_he} ${listing.category.emoji}` : '—')}`
  );
  lines.push(`${t('card.location')}: ${esc(locationText(listing, lang) || '—')}`);
  lines.push('');
  lines.push(`📝 ${esc(listing.description)}`);
  lines.push('');

  if (showSeller) {
    const name = seller.username ? `@${esc(seller.username)}` : esc(seller.full_name || '—');
    const badgeLine = badges(seller, t);
    lines.push(
      `${t('card.seller')}: ${name}${average ? ` · ${stars(average)} ${average.toFixed(1)}` : ''}`
    );
    if (badgeLine) lines.push(`🏅 ${badgeLine}`);
  }

  lines.push(
    `${t('card.views')}: ${n(listing.views_count)} · ${t('card.published')}: ${fmt.formatDate(
      listing.approved_at || listing.created_at
    )} (${relativeAge(listing.created_at, i18n.normalize(lang))})`
  );
  lines.push(`${t('card.id')}: <code>${fmt.adId(listing.id)}</code>`);

  if (page !== null && total !== null) {
    lines.push(SOFT_DIVIDER);
    lines.push(`📄 ${t('common.page', { current: page + 1, total })}`);
  }

  return lines.join('\n');
}

/* ------------------------------ פרופיל מוכר ------------------------------ */

function sellerProfile(user, stats, lang) {
  const t = i18n.translator(lang);
  const average = ratingOf(user);
  const badgeLine = badges(user, t);

  return [
    t('seller.title'),
    DIVIDER,
    `👤 <b>${esc(user.full_name || '—')}</b>${user.username ? ` · @${esc(user.username)}` : ''}`,
    badgeLine ? `🏅 ${badgeLine}` : null,
    '',
    `${t('seller.rating')}: ${average ? `${stars(average)} ${average.toFixed(1)}/5 (${n(user.rating_count)})` : '—'}`,
    `${t('seller.listings')}: ${n(stats.active)}`,
    `${t('seller.sold')}: ${n(stats.sold)}`,
    `${t('stats.views')}: ${n(stats.views)}`,
    `${t('seller.member')}: ${fmt.formatDate(user.created_at)}`,
  ]
    .filter((line) => line !== null && line !== undefined)
    .join('\n');
}

/* ------------------------- לוח הבקרה האישי (משתמש) ------------------------- */

function personalDashboard(user, stats, lang) {
  const t = i18n.translator(lang);
  const average = ratingOf(user);
  const maxViews = Math.max(stats.views, 1);

  return [
    t('stats.title'),
    DIVIDER,
    `👤 <b>${esc(user.full_name || '—')}</b>${user.username ? ` · @${esc(user.username)}` : ''}`,
    `🌐 ${i18n.localeName(lang)}`,
    average ? `${t('stats.rating')}: ${stars(average)} ${average.toFixed(1)}/5` : `${t('stats.rating')}: —`,
    '',
    `${t('stats.active')}: <b>${n(stats.active)}</b>`,
    `${t('stats.pending')}: ${n(stats.pending)}`,
    `${t('stats.sold')}: ${n(stats.sold)}`,
    `⭐️ ${n(stats.favorites)}`,
    '',
    `${t('stats.performance')}`,
    `${t('stats.views')}  ${bar(stats.views, maxViews)} ${n(stats.views)}`,
    `${t('stats.contacts')} ${bar(stats.contacts, maxViews)} ${n(stats.contacts)}`,
  ].join('\n');
}

/* --------------------------------- הגדרות --------------------------------- */

function settingsCard(user, lang) {
  const t = i18n.translator(lang);
  return [
    t('settings.title'),
    DIVIDER,
    t('settings.body'),
    '',
    `${t('settings.language')}: <b>${i18n.localeName(lang)}</b>`,
    user.notifications_enabled === false ? t('settings.notifOff') : t('settings.notifOn'),
    user.show_phone ? t('settings.privacyOn') : t('settings.privacyOff'),
    `${t('settings.phone')}: ${user.phone_number ? `<code>${esc(user.phone_number)}</code>` : '—'}`,
  ].join('\n');
}

/* -------------------------------- התראות -------------------------------- */

function alertLine(search, index, lang) {
  const parts = [];
  if (search.q) parts.push(`🔤 "${esc(search.q)}"`);
  if (search.category_id) parts.push(`🗂️ #${search.category_id}`);
  if (search.location) parts.push(`📍 ${esc(search.location)}`);
  if (search.min_price !== null || search.max_price !== null) {
    parts.push(`💰 ₪${n(search.min_price || 0)}-${search.max_price ? n(search.max_price) : '∞'}`);
  }
  if (search.free_only) parts.push('🎁');
  const t = i18n.translator(lang);
  return `${index + 1}. ${parts.join(' · ') || t('common.none')} — 🔔 ${n(search.hits_count)}`;
}

function alertsCard(searches, lang) {
  const t = i18n.translator(lang);
  if (!searches.length) return `${t('alerts.title')}\n${DIVIDER}\n${t('alerts.none')}`;
  return [
    t('alerts.title'),
    DIVIDER,
    t('alerts.body'),
    '',
    ...searches.map((search, index) => alertLine(search, index, lang)),
  ].join('\n');
}

/* -------------------------------- אנליטיקס -------------------------------- */

function analyticsReport(snapshot, series, lang) {
  const t = i18n.translator(lang);
  const m = snapshot.metrics;

  const categories = snapshot.topCategories
    .map(
      (category, index) =>
        `${index + 1}. ${category.emoji} ${esc(category.name_he)} — ${n(category.active_listings)} | 👁️ ${n(
          category.total_views
        )}`
    )
    .join('\n');

  const sellers = snapshot.topSellers
    .map((seller, index) => {
      const average = seller.rating_count ? (seller.rating_sum / seller.rating_count).toFixed(1) : '—';
      const name = seller.username ? `@${esc(seller.username)}` : esc(seller.full_name);
      return `${index + 1}. ${name} — 🏷️ ${n(seller.sold_listings)} | ⭐ ${average}`;
    })
    .join('\n');

  const languages = snapshot.languages
    .map((row) => `${i18n.localeName(row.lang)} — ${n(row.count)}`)
    .join('\n');

  return [
    `📈 <b>Analytics</b> · ${t('admin.title').replace(/<\/?b>/g, '')}`,
    DIVIDER,
    '👥 <b>Users</b>',
    `• ${n(m.totalUsers)} total · ${n(m.activeUsers)} active · ${n(m.bannedUsers)} banned`,
    `• +${n(snapshot.users7)} (7d) · +${n(snapshot.users30)} (30d)`,
    '',
    '🛍️ <b>Listings</b>',
    `• ${n(m.approved)} live · ${n(m.pending)} pending · ${n(m.sold)} sold · ${n(m.rejected)} rejected`,
    `• +${n(snapshot.listings7)} (7d) · ✅ ${n(snapshot.approved7)} approved (7d) · 🏷️ ${n(snapshot.sold7)} sold (7d)`,
    `• ✅ Approval rate: <b>${snapshot.approvalRate}%</b>`,
    `• 🚩 Open reports: ${n(snapshot.reportsOpen)}`,
    '',
    '📊 <b>New listings (7 days)</b>',
    sparkChart(series),
    '',
    '🗂️ <b>Top categories</b>',
    categories || '—',
    '',
    '🏆 <b>Top sellers</b>',
    sellers || '—',
    '',
    '🌐 <b>Languages</b>',
    languages || '—',
    '',
    `🕐 ${fmt.formatDateTime(new Date())}`,
  ].join('\n');
}

/* --------------------------------- אדמין --------------------------------- */

function adminUserCard(user, stats, lang) {
  const t = i18n.translator(lang);
  const average = ratingOf(user);
  return [
    `👤 <b>${esc(user.full_name || '—')}</b>${user.username ? ` · @${esc(user.username)}` : ''}`,
    DIVIDER,
    `🆔 DB: <code>${user.id}</code> · TG: <code>${user.telegram_id}</code>`,
    `📊 ${user.status === 'banned' ? '🚫 banned' : '🟢 active'}${user.is_verified ? ' · ✔️' : ''}${
      user.is_vip ? ' · 💎' : ''
    }`,
    `🌐 ${i18n.localeName(user.language)}`,
    user.phone_number ? `📱 <code>${esc(user.phone_number)}</code>` : null,
    '',
    `${t('stats.active')}: ${n(stats.active)} · ${t('stats.pending')}: ${n(stats.pending)} · ${t(
      'stats.sold'
    )}: ${n(stats.sold)}`,
    `${t('stats.views')}: ${n(stats.views)} · ${t('stats.contacts')}: ${n(stats.contacts)}`,
    `${t('stats.rating')}: ${average ? `${stars(average)} ${average.toFixed(1)} (${n(user.rating_count)})` : '—'}`,
    `📅 ${fmt.formatDate(user.created_at)} · 👀 ${fmt.formatDateTime(user.last_seen_at)}`,
    user.ban_reason ? `📌 ${esc(user.ban_reason)}` : null,
  ]
    .filter((line) => line !== null && line !== undefined)
    .join('\n');
}

const REPORT_LABELS = {
  spam: '📢 spam',
  fraud: '🕵️ fraud',
  sold: '🏷️ already sold',
  forbidden: '🚫 forbidden',
  other: '❓ other',
};

function reportCard(report, lang) {
  const t = i18n.translator(lang);
  const listing = report.listing || {};
  return [
    t('report.adminNew'),
    DIVIDER,
    `🛍️ <b>${esc(listing.title || '—')}</b>`,
    `🆔 <code>${fmt.adId(listing.id || 0)}</code> · status: ${esc(listing.status || '—')}`,
    `🚩 ${REPORT_LABELS[report.reason] || esc(report.reason)}`,
    `📊 total reports on listing: ${n(listing.report_count)}`,
    report.note ? `📝 ${esc(report.note)}` : null,
    `📅 ${fmt.formatDateTime(report.created_at)}`,
  ]
    .filter((line) => line !== null && line !== undefined)
    .join('\n');
}

function auditCard(rows, lang) {
  const t = i18n.translator(lang);
  if (!rows.length) return `${t('admin.audit')}\n${DIVIDER}\n${t('common.none')}`;
  return [
    `🧾 <b>${t('admin.audit').replace(/^[^\s]+\s/, '')}</b>`,
    DIVIDER,
    ...rows.map(
      (row) =>
        `• <code>${fmt.formatDateTime(row.created_at)}</code> — ${esc(row.admin_name || row.admin_id)} → <b>${esc(
          row.action
        )}</b>${row.target_id ? ` (${esc(row.target_type || '')}#${esc(row.target_id)})` : ''}`
    ),
  ].join('\n');
}

function settingsAdminCard(settings, lang) {
  const t = i18n.translator(lang);
  const flag = (value) => (value === true || value === 'true' ? '🟢 ON' : '🔴 OFF');
  return [
    `⚙️ <b>${t('admin.settings').replace(/^[^\s]+\s/, '')}</b>`,
    DIVIDER,
    `🤖 Auto approve: ${flag(settings.auto_approve)}`,
    `🚧 Maintenance mode: ${flag(settings.maintenance_mode)}`,
    `📸 Require photo: ${flag(settings.require_photo)}`,
    `📊 Max ads / day: <b>${n(settings.max_ads_per_day)}</b>`,
    `🔔 Max alerts / user: <b>${n(settings.max_alerts)}</b>`,
    `⏳ Listing TTL: <b>${n(settings.listing_ttl_days)}</b> days`,
  ].join('\n');
}

function blockedWordsCard(words, lang) {
  const t = i18n.translator(lang);
  if (!words.length) return `🚫 <b>Blocked words</b>\n${DIVIDER}\n${t('common.none')}`;
  return [
    '🚫 <b>Blocked words</b>',
    DIVIDER,
    ...words.map((entry) => `• ${esc(entry.word)} — ${entry.severity === 'flag' ? '🟡 flag' : '🔴 block'}`),
  ].join('\n');
}

module.exports = {
  DIVIDER,
  SOFT_DIVIDER,
  esc,
  n,
  stars,
  ratingOf,
  bar,
  sparkChart,
  priceText,
  conditionText,
  locationText,
  badges,
  relativeAge,

  listingCard,
  sellerProfile,
  personalDashboard,
  settingsCard,
  alertsCard,
  alertLine,

  analyticsReport,
  adminUserCard,
  reportCard,
  auditCard,
  settingsAdminCard,
  blockedWordsCard,
};
