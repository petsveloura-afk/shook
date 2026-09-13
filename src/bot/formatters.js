'use strict';

/**
 * עיצוב טקסטים (parse_mode: HTML) — פוסטים בערוץ, תצוגות מקדימות, פרופיל, אדמין.
 */

const { CONDITIONS, REJECT_REASONS } = require('./keyboards');
const env = require('../config/env');

const STATUS_LABELS = {
  pending: '⏳ ממתינה לאישור מנהל',
  approved: '🟢 מפורסמת בערוץ',
  rejected: '🔴 נדחתה',
  sold: '🏷️ נמכר',
  deleted: '🗑️ נמחקה',
};

/** בריחה מתווי HTML כדי למנוע שבירת הודעות ו-HTML injection. */
function esc(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function adId(id) {
  return `#ID${String(id).padStart(4, '0')}`;
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString('he-IL');
}

function formatPrice(listing) {
  if (!listing) return '';
  if (listing.price_type === 'free') return 'למסירה בחינם 🎁';
  const amount = `₪${formatNumber(Math.round(Number(listing.price || 0)))}`;
  if (listing.price_type === 'flexible') return `${amount} (מחיר גמיש 🤝)`;
  return amount;
}

function formatCondition(condition) {
  return CONDITIONS[condition] || 'לא צוין';
}

function formatDate(value) {
  const date = value ? new Date(value) : new Date();
  return date.toLocaleDateString('he-IL', {
    timeZone: 'Asia/Jerusalem',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function formatDateTime(value) {
  const date = value ? new Date(value) : new Date();
  return date.toLocaleString('he-IL', {
    timeZone: 'Asia/Jerusalem',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatRating(user) {
  if (!user || !Number(user.rating_count)) return 'מוכר חדש 🆕';
  const average = Number(user.rating_sum) / Number(user.rating_count);
  return `${average.toFixed(1)}/5 (${formatNumber(user.rating_count)} עסקאות)`;
}

function sellerLine(user) {
  if (!user) return 'לא ידוע';
  const name = esc(user.full_name || 'משתמש');
  return user.username ? `${name} / <code>@${esc(user.username)}</code>` : name;
}

function categoryLine(listing) {
  const category = listing.category;
  if (!category) return 'שונות ✨';
  return `${esc(category.name_he)} ${category.emoji || ''}`.trim();
}

/* ============================================================================
 *  פוסט הערוץ — העיצוב הראשי
 * ========================================================================== */

function channelPost(listing, { sold = false } = {}) {
  const seller = listing.seller || {};
  const lines = [];

  if (sold) lines.push('🔴 <b>המודעה נמכרה — אין צורך לפנות</b> 🔴', '');

  lines.push(`🔥 <b>${esc(listing.title)}</b> 🔥`, '');
  lines.push(`💰 <b>מחיר:</b> ${sold ? '<s>' + esc(formatPrice(listing)) + '</s>' : formatPrice(listing)}`);
  lines.push(`🏷️ <b>קטגוריה:</b> ${categoryLine(listing)}`);
  lines.push(`✨ <b>מצב המוצר:</b> ${esc(formatCondition(listing.condition))}`);
  lines.push(`📍 <b>מיקום:</b> ${esc(listing.location || 'לא צוין')}`);
  lines.push('');
  lines.push('📝 <b>תיאור:</b>');
  lines.push(esc(listing.description));
  lines.push('');
  lines.push(`👤 <b>מוכר:</b> ${sellerLine(seller)}`);
  lines.push(`⭐ <b>דירוג מוכר:</b> ${esc(formatRating(seller))}`);
  lines.push(`📅 <b>פורסם ב:</b> ${formatDate(listing.approved_at || listing.created_at)}`);
  lines.push('');
  lines.push(`🆔 <b>מזהה מודעה:</b> <code>${adId(listing.id)}</code>`);

  if (env.CHANNEL_URL) lines.push('', '➖➖➖➖➖➖➖➖➖➖➖');

  return lines.join('\n');
}

/* ============================================================================
 *  תצוגה מקדימה ללפני שליחה
 * ========================================================================== */

function previewCard(draft, { categoryName = '', photosCount = 0 } = {}) {
  const fakeListing = {
    id: 0,
    title: draft.title || '',
    description: draft.description || '',
    condition: draft.condition,
    price: draft.price,
    price_type: draft.price_type,
    location: draft.location,
  };

  return [
    '👁️ <b>תצוגה מקדימה של המודעה שלך</b>',
    '➖➖➖➖➖➖➖➖➖➖➖',
    '',
    `🔥 <b>${esc(fakeListing.title)}</b> 🔥`,
    '',
    `💰 <b>מחיר:</b> ${formatPrice(fakeListing)}`,
    `🏷️ <b>קטגוריה:</b> ${esc(categoryName)}`,
    `✨ <b>מצב המוצר:</b> ${esc(formatCondition(fakeListing.condition))}`,
    `📍 <b>מיקום:</b> ${esc(fakeListing.location || 'לא צוין')}`,
    '',
    '📝 <b>תיאור:</b>',
    esc(fakeListing.description),
    '',
    `📸 <b>תמונות:</b> ${photosCount} מצורפות`,
    '➖➖➖➖➖➖➖➖➖➖➖',
    '',
    'האם לשלוח את המודעה לאישור המנהל? 👇',
  ].join('\n');
}

/* ============================================================================
 *  כרטיסים למשתמש
 * ========================================================================== */

function searchCard(listing, { page = 0, total = 0 } = {}) {
  const seller = listing.seller || {};
  return [
    `🔥 <b>${esc(listing.title)}</b>`,
    '',
    `💰 <b>מחיר:</b> ${formatPrice(listing)}`,
    `🏷️ <b>קטגוריה:</b> ${categoryLine(listing)}`,
    `✨ <b>מצב:</b> ${esc(formatCondition(listing.condition))}`,
    `📍 <b>מיקום:</b> ${esc(listing.location || 'לא צוין')}`,
    '',
    `📝 ${esc(listing.description)}`,
    '',
    `👤 <b>מוכר:</b> ${sellerLine(seller)} | ⭐ ${esc(formatRating(seller))}`,
    `📅 ${formatDate(listing.created_at)} | 👁️ ${formatNumber(listing.views_count)} צפיות`,
    `🆔 <code>${adId(listing.id)}</code>`,
    '',
    `📄 מודעה ${page + 1} מתוך ${total}`,
  ].join('\n');
}

function myListingCard(listing, { page = 0, total = 0 } = {}) {
  return [
    `📋 <b>${esc(listing.title)}</b>`,
    '',
    `📊 <b>סטטוס:</b> ${STATUS_LABELS[listing.status] || listing.status}`,
    listing.status === 'rejected' && listing.reject_reason
      ? `📌 <b>סיבת הדחייה:</b> ${esc(REJECT_REASONS[listing.reject_reason] || listing.reject_reason)}`
      : null,
    `💰 <b>מחיר:</b> ${formatPrice(listing)}`,
    `🏷️ <b>קטגוריה:</b> ${categoryLine(listing)}`,
    `📍 <b>מיקום:</b> ${esc(listing.location || 'לא צוין')}`,
    '',
    `👁️ <b>צפיות:</b> ${formatNumber(listing.views_count)} | 📩 <b>פניות:</b> ${formatNumber(listing.contacts_count)}`,
    `📅 <b>נוצרה:</b> ${formatDateTime(listing.created_at)}`,
    listing.bumped_at ? `🔄 <b>הוקפצה:</b> ${formatDateTime(listing.bumped_at)}` : null,
    `🆔 <code>${adId(listing.id)}</code>`,
    '',
    `📄 מודעה ${page + 1} מתוך ${total}`,
  ]
    .filter((line) => line !== null && line !== undefined)
    .join('\n');
}

function favoriteCard(listing, { page = 0, total = 0 } = {}) {
  return [
    `⭐️ <b>${esc(listing.title)}</b>`,
    '',
    `💰 ${formatPrice(listing)} | 📍 ${esc(listing.location || 'לא צוין')}`,
    `🏷️ ${categoryLine(listing)} | 📊 ${STATUS_LABELS[listing.status] || listing.status}`,
    '',
    `📝 ${esc(listing.description)}`,
    `🆔 <code>${adId(listing.id)}</code>`,
    '',
    `📄 מועדף ${page + 1} מתוך ${total}`,
  ].join('\n');
}

function profileCard(user, stats) {
  return [
    '👤 <b>האזור האישי שלך</b>',
    '➖➖➖➖➖➖➖➖➖➖➖',
    '',
    `🙋 <b>שם:</b> ${esc(user.full_name)}`,
    user.username ? `🔗 <b>יוזר:</b> <code>@${esc(user.username)}</code>` : null,
    user.phone_number ? `📱 <b>טלפון:</b> <code>${esc(user.phone_number)}</code>` : '📱 <b>טלפון:</b> לא הוגדר',
    `⭐ <b>דירוג:</b> ${esc(formatRating(user))}`,
    `📅 <b>חבר מתאריך:</b> ${formatDate(user.created_at)}`,
    '',
    '📊 <b>סטטיסטיקת המודעות שלך:</b>',
    `🟢 מפורסמות: ${formatNumber(stats.approved)}`,
    `⏳ ממתינות לאישור: ${formatNumber(stats.pending)}`,
    `🏷️ נמכרו: ${formatNumber(stats.sold)}`,
    `🔴 נדחו: ${formatNumber(stats.rejected)}`,
    `⭐️ מועדפים: ${formatNumber(stats.favorites)}`,
  ]
    .filter((line) => line !== null && line !== undefined)
    .join('\n');
}

function contactCard(listing) {
  const seller = listing.seller || {};
  const lines = [
    '📩 <b>פרטי יצירת קשר</b>',
    '➖➖➖➖➖➖➖➖➖➖➖',
    '',
    `🛍️ <b>מודעה:</b> ${esc(listing.title)}`,
    `💰 <b>מחיר:</b> ${formatPrice(listing)}`,
    `🆔 <code>${adId(listing.id)}</code>`,
    '',
    `👤 <b>המוכר:</b> ${esc(seller.full_name || 'משתמש')}`,
  ];

  if (seller.username) lines.push(`💬 <b>צ'אט ישיר:</b> @${esc(seller.username)}`);
  if (seller.phone_number) lines.push(`📱 <b>טלפון:</b> <code>${esc(seller.phone_number)}</code>`);
  if (!seller.username && !seller.phone_number) {
    lines.push('', 'ℹ️ המוכר לא שיתף פרטי קשר ישירים — שלחנו לו התראה שהתעניינת והוא יחזור אליך.');
  }

  lines.push('', '⚠️ <b>המשך בזהירות:</b> בצעו עסקאות פנים מול פנים ובדקו את המוצר לפני תשלום.');
  return lines.join('\n');
}

/* ============================================================================
 *  אדמין
 * ========================================================================== */

function moderationCard(listing) {
  const seller = listing.seller || {};
  return [
    '🛡️ <b>מודעה חדשה ממתינה לאישור</b>',
    '➖➖➖➖➖➖➖➖➖➖➖',
    '',
    `🔥 <b>${esc(listing.title)}</b>`,
    '',
    `💰 <b>מחיר:</b> ${formatPrice(listing)}`,
    `🏷️ <b>קטגוריה:</b> ${categoryLine(listing)}`,
    `✨ <b>מצב:</b> ${esc(formatCondition(listing.condition))}`,
    `📍 <b>מיקום:</b> ${esc(listing.location || 'לא צוין')}`,
    `📸 <b>תמונות:</b> ${(listing.photos || []).length}`,
    '',
    '📝 <b>תיאור:</b>',
    esc(listing.description),
    '',
    `👤 <b>מוכר:</b> ${sellerLine(seller)}`,
    `🆔 <b>Telegram ID:</b> <code>${esc(seller.telegram_id)}</code>`,
    `⭐ <b>דירוג:</b> ${esc(formatRating(seller))}`,
    `📅 <b>נשלחה:</b> ${formatDateTime(listing.created_at)}`,
    '',
    `🆔 <b>מזהה מודעה:</b> <code>${adId(listing.id)}</code> (DB: ${listing.id})`,
  ].join('\n');
}

function metricsCard(metrics) {
  return [
    '🛡️ <b>פאנל ניהול — Pashpashuk</b>',
    '➖➖➖➖➖➖➖➖➖➖➖',
    '',
    '👥 <b>משתמשים</b>',
    `• סה"כ: ${formatNumber(metrics.totalUsers)}`,
    `• פעילים: ${formatNumber(metrics.activeUsers)}`,
    `• חסומים: ${formatNumber(metrics.bannedUsers)}`,
    '',
    '🛍️ <b>מודעות</b>',
    `• ממתינות לאישור: ${formatNumber(metrics.pending)}`,
    `• מפורסמות: ${formatNumber(metrics.approved)}`,
    `• נמכרו: ${formatNumber(metrics.sold)}`,
    `• נדחו: ${formatNumber(metrics.rejected)}`,
    '',
    `🗂️ <b>קטגוריות:</b> ${formatNumber(metrics.categories)}`,
    `🕐 <b>עודכן:</b> ${formatDateTime(new Date())}`,
  ].join('\n');
}

module.exports = {
  esc,
  adId,
  formatNumber,
  formatPrice,
  formatCondition,
  formatDate,
  formatDateTime,
  formatRating,
  STATUS_LABELS,

  channelPost,
  previewCard,
  searchCard,
  myListingCard,
  favoriteCard,
  profileCard,
  contactCard,
  moderationCard,
  metricsCard,
};
