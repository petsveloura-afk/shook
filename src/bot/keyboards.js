'use strict';

/**
 * כל המקלדות (Reply + Inline) בעברית.
 * מבנה callback_data: "prefix:arg1:arg2" — תמיד מתחת ל-64 בייט.
 */

const { Markup } = require('telegraf');
const env = require('../config/env');

/* ------------------------------- קונסטנטים ------------------------------- */

const MENU = {
  NEW: '➕ פרסום מודעה חדשה',
  SEARCH: '🔍 חיפוש וסינון מוצרים',
  ME: '👤 האזור האישי והמודעות שלי',
  FAV: '⭐️ המועדפים שלי',
  CHANNEL: '📢 מעבר לערוץ המכירות',
  SUPPORT: '📞 תמיכה ויצירת קשר',
};

const CANCEL = '❌ ביטול';
const SKIP = '⏭️ דלג';
const DONE_PHOTOS = '✅ סיימתי להעלות תמונות';
const SHARE_PHONE = '📱 שיתוף מספר הטלפון שלי';

const CONDITIONS = {
  new_sealed: 'חדש באריזה 🎁',
  like_new: 'כמו חדש ✨',
  good: 'משומש במצב טוב 👍',
  parts: 'לא עובד / לחלקים 🛠️',
};

const REGIONS = [
  'צפון והגליל',
  'חיפה והקריות',
  'השרון',
  'גוש דן',
  'ירושלים והסביבה',
  'שפלה',
  'דרום ובאר שבע',
  'אילת והערבה',
  'יהודה ושומרון',
  'כל הארץ / משלוחים',
];

const REJECT_REASONS = {
  spam: 'ספאם או פרסום מסחרי',
  forbidden: 'מוצר אסור לפרסום',
  duplicate: 'מודעה כפולה',
  photos: 'תמונות חסרות או לא ברורות',
  price: 'מחיר לא הגיוני / לא תואם',
  details: 'תיאור חסר או לא מפורט',
  other: 'לא עומד בתקנון הערוץ',
};

/* ------------------------------ Reply Keyboards ------------------------------ */

const mainMenu = () =>
  Markup.keyboard([
    [MENU.NEW],
    [MENU.SEARCH, MENU.ME],
    [MENU.FAV, MENU.CHANNEL],
    [MENU.SUPPORT],
  ]).resize();

const cancelOnly = () => Markup.keyboard([[CANCEL]]).resize();

const skipOrCancel = () => Markup.keyboard([[SKIP], [CANCEL]]).resize();

const photosKeyboard = () => Markup.keyboard([[DONE_PHOTOS], [CANCEL]]).resize();

const phoneKeyboard = () =>
  Markup.keyboard([[Markup.button.contactRequest(SHARE_PHONE)], [CANCEL]]).resize();

const removeKeyboard = () => Markup.removeKeyboard();

/* ------------------------------ Inline Keyboards ----------------------------- */

/** גריד קטגוריות. prefix לדוגמה: 'cat:' או 'sc:' */
function categoriesGrid(categories, prefix, extraRows = []) {
  const buttons = categories.map((category) =>
    Markup.button.callback(`${category.emoji} ${category.name_he}`, `${prefix}${category.id}`)
  );

  const rows = [];
  for (let i = 0; i < buttons.length; i += 2) rows.push(buttons.slice(i, i + 2));

  return Markup.inlineKeyboard([...rows, ...extraRows]);
}

function conditionKeyboard() {
  const entries = Object.entries(CONDITIONS);
  const rows = [];
  for (let i = 0; i < entries.length; i += 2) {
    rows.push(
      entries.slice(i, i + 2).map(([key, label]) => Markup.button.callback(label, `cond:${key}`))
    );
  }
  return Markup.inlineKeyboard(rows);
}

function priceKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🎁 למסירה בחינם', 'price:free')],
    [Markup.button.callback('🤝 מחיר גמיש (נתון למשא ומתן)', 'price:flex')],
  ]);
}

function regionsKeyboard(prefix = 'loc:', extraRows = []) {
  const buttons = REGIONS.map((region, index) =>
    Markup.button.callback(`📍 ${region}`, `${prefix}${index}`)
  );
  const rows = [];
  for (let i = 0; i < buttons.length; i += 2) rows.push(buttons.slice(i, i + 2));
  return Markup.inlineKeyboard([...rows, ...extraRows]);
}

function photosDoneInline(count) {
  return Markup.inlineKeyboard([
    [Markup.button.callback(`✅ סיימתי (${count} תמונות)`, 'ph:done')],
    [Markup.button.callback('🗑️ איפוס התמונות', 'ph:reset')],
  ]);
}

function previewKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('✅ אישור ושליחה לאישור מנהל', 'pv:confirm')],
    [Markup.button.callback('✏️ עריכת פרטים', 'pv:edit')],
    [Markup.button.callback('❌ ביטול המודעה', 'pv:cancel')],
  ]);
}

function editFieldsKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('🏷️ שם המוצר', 'ed:title'),
      Markup.button.callback('📝 תיאור', 'ed:desc'),
    ],
    [
      Markup.button.callback('💰 מחיר', 'ed:price'),
      Markup.button.callback('✨ מצב המוצר', 'ed:cond'),
    ],
    [
      Markup.button.callback('🗂️ קטגוריה', 'ed:cat'),
      Markup.button.callback('📍 מיקום', 'ed:loc'),
    ],
    [Markup.button.callback('📸 תמונות', 'ed:photos')],
    [Markup.button.callback('⬅️ חזרה לתצוגה מקדימה', 'ed:back')],
  ]);
}

/* --------------------------------- ערוץ --------------------------------- */

/** כפתורי הפוסט בערוץ — Deep Links (עובדים תמיד, גם ללא הרשאות callback בערוץ). */
function channelKeyboard(listingId) {
  return Markup.inlineKeyboard([
    [
      Markup.button.url('📩 צור קשר עם המוכר', env.botLink(`contact_${listingId}`)),
      Markup.button.url('⭐️ שמור במועדפים', env.botLink(`fav_${listingId}`)),
    ],
    [Markup.button.url('🤖 לפרסום מודעה דרך הבוט', env.botLink('publish'))],
  ]);
}

/* ------------------------------ תפריט חיפוש ------------------------------ */

function searchMenu(filters = {}) {
  const mark = (value) => (value ? ' ✅' : '');
  return Markup.inlineKeyboard([
    [Markup.button.callback(`🔤 חיפוש חופשי${mark(filters.q)}`, 's:text')],
    [
      Markup.button.callback(`🗂️ קטגוריה${mark(filters.categoryId)}`, 's:cat'),
      Markup.button.callback(`📍 אזור${mark(filters.location)}`, 's:loc'),
    ],
    [
      Markup.button.callback(
        `💰 טווח מחירים${mark(Number.isFinite(filters.minPrice) || Number.isFinite(filters.maxPrice))}`,
        's:price'
      ),
      Markup.button.callback(`🎁 רק בחינם${mark(filters.freeOnly)}`, 's:free'),
    ],
    [Markup.button.callback('🚀 הצג תוצאות', 's:run')],
    [Markup.button.callback('🧹 איפוס סינונים', 's:reset')],
  ]);
}

/** כפתורי כרטיס תוצאה בחיפוש. */
function resultCardKeyboard(listing, { page, total, isFav }) {
  const nav = [];
  if (page > 0) nav.push(Markup.button.callback('➡️ הקודם', `res:${page - 1}`));
  if (page < total - 1) nav.push(Markup.button.callback('⬅️ הבא', `res:${page + 1}`));

  return Markup.inlineKeyboard([
    [
      Markup.button.callback(
        isFav ? '💔 הסר מהמועדפים' : '⭐️ שמור במועדפים',
        isFav ? `fav:del:${listing.id}` : `fav:add:${listing.id}`
      ),
    ],
    [Markup.button.callback('📩 צור קשר עם המוכר', `ct:${listing.id}`)],
    ...(nav.length ? [nav] : []),
    [Markup.button.callback('🔍 חיפוש חדש', 's:menu')],
  ]);
}

/** כפתורי ניהול מודעה ב"המודעות שלי". */
function myListingKeyboard(listing, { page, total }) {
  const rows = [];

  if (listing.status === 'approved') {
    rows.push([
      Markup.button.callback('🏷️ סמן כנמכר', `my:sold:${listing.id}`),
      Markup.button.callback('🔄 הקפץ מודעה', `my:bump:${listing.id}`),
    ]);
  }
  if (listing.status !== 'deleted') {
    rows.push([Markup.button.callback('🗑️ מחק מודעה', `my:del:${listing.id}`)]);
  }

  const nav = [];
  if (page > 0) nav.push(Markup.button.callback('➡️ הקודם', `my:${page - 1}`));
  if (page < total - 1) nav.push(Markup.button.callback('⬅️ הבא', `my:${page + 1}`));
  if (nav.length) rows.push(nav);

  rows.push([Markup.button.callback('👤 חזרה לאזור האישי', 'm:me')]);
  return Markup.inlineKeyboard(rows);
}

function confirmDeleteKeyboard(listingId) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🗑️ כן, מחק לצמיתות', `my:deldo:${listingId}`)],
    [Markup.button.callback('↩️ לא, בטל', 'my:0')],
  ]);
}

function favoriteCardKeyboard(listing, { page, total }) {
  const nav = [];
  if (page > 0) nav.push(Markup.button.callback('➡️ הקודם', `fv:${page - 1}`));
  if (page < total - 1) nav.push(Markup.button.callback('⬅️ הבא', `fv:${page + 1}`));

  return Markup.inlineKeyboard([
    [Markup.button.callback('💔 הסר מהמועדפים', `fav:rm:${listing.id}:${page}`)],
    [Markup.button.callback('📩 צור קשר עם המוכר', `ct:${listing.id}`)],
    ...(nav.length ? [nav] : []),
  ]);
}

function personalAreaKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('📋 המודעות שלי', 'my:0')],
    [Markup.button.callback('⭐️ המועדפים שלי', 'fv:0')],
    [Markup.button.callback('📱 עדכון מספר טלפון', 'me:phone')],
    [Markup.button.callback('➕ פרסום מודעה חדשה', 'm:new')],
  ]);
}

function ratingKeyboard(listingId) {
  return Markup.inlineKeyboard([
    [1, 2, 3, 4, 5].map((stars) =>
      Markup.button.callback('⭐'.repeat(stars), `rate:${listingId}:${stars}`)
    ),
  ]);
}

/* ------------------------------ מודרציה / אדמין ------------------------------ */

function moderationKeyboard(listing) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('🟢 אשר ופרסם', `a:ok:${listing.id}`),
      Markup.button.callback('🔴 דחה', `a:rej:${listing.id}`),
    ],
    [
      Markup.button.callback('✏️ ערוך', `a:ed:${listing.id}`),
      Markup.button.callback('🚫 חסום משתמש', `a:ban:${listing.id}`),
    ],
  ]);
}

function rejectReasonsKeyboard(listingId) {
  const rows = Object.entries(REJECT_REASONS).map(([code, label]) => [
    Markup.button.callback(`🔴 ${label}`, `a:rr:${listingId}:${code}`),
  ]);
  rows.push([Markup.button.callback('↩️ חזרה', `a:back:${listingId}`)]);
  return Markup.inlineKeyboard(rows);
}

function adminEditFieldsKeyboard(listingId) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('🏷️ שם', `a:ef:${listingId}:title`),
      Markup.button.callback('📝 תיאור', `a:ef:${listingId}:description`),
    ],
    [
      Markup.button.callback('💰 מחיר', `a:ef:${listingId}:price`),
      Markup.button.callback('📍 מיקום', `a:ef:${listingId}:location`),
    ],
    [Markup.button.callback('↩️ חזרה', `a:back:${listingId}`)],
  ]);
}

function adminPanelKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🔄 רענון נתונים', 'a:panel')],
    [Markup.button.callback('📥 מודעות הממתינות לאישור', 'a:queue')],
    [Markup.button.callback('📢 שליחת הודעה לכל המשתמשים', 'a:bc')],
    [Markup.button.callback('🗂️ ניהול קטגוריות', 'a:cats')],
    [Markup.button.callback('🗑️ הסרת מודעה לפי מזהה', 'a:rm')],
    [Markup.button.callback('🚫 חסימה / שחרור משתמש', 'a:banmenu')],
  ]);
}

function adminCategoriesKeyboard(categories) {
  const rows = categories.map((category) => [
    Markup.button.callback(
      `🗑️ ${category.emoji} ${category.name_he}`,
      `a:catdel:${category.id}`
    ),
  ]);
  rows.push([Markup.button.callback('➕ הוספת קטגוריה', 'a:catadd')]);
  rows.push([Markup.button.callback('↩️ חזרה לפאנל', 'a:panel')]);
  return Markup.inlineKeyboard(rows);
}

function broadcastConfirmKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('📢 כן, שלח לכולם', 'a:bcok')],
    [Markup.button.callback('❌ ביטול', 'a:bccancel')],
  ]);
}

function backToPanelKeyboard() {
  return Markup.inlineKeyboard([[Markup.button.callback('↩️ חזרה לפאנל', 'a:panel')]]);
}

function channelLinkKeyboard() {
  const rows = [];
  if (env.CHANNEL_URL) rows.push([Markup.button.url('📢 מעבר לערוץ המכירות', env.CHANNEL_URL)]);
  return Markup.inlineKeyboard(rows);
}

function supportKeyboard() {
  const rows = [];
  if (env.SUPPORT_USERNAME) {
    rows.push([
      Markup.button.url('💬 פנייה לתמיכה', `https://t.me/${env.SUPPORT_USERNAME}`),
    ]);
  }
  if (env.CHANNEL_URL) rows.push([Markup.button.url('📢 ערוץ המכירות', env.CHANNEL_URL)]);
  return Markup.inlineKeyboard(rows);
}

module.exports = {
  MENU,
  CANCEL,
  SKIP,
  DONE_PHOTOS,
  SHARE_PHONE,
  CONDITIONS,
  REGIONS,
  REJECT_REASONS,

  mainMenu,
  cancelOnly,
  skipOrCancel,
  photosKeyboard,
  phoneKeyboard,
  removeKeyboard,

  categoriesGrid,
  conditionKeyboard,
  priceKeyboard,
  regionsKeyboard,
  photosDoneInline,
  previewKeyboard,
  editFieldsKeyboard,

  channelKeyboard,
  searchMenu,
  resultCardKeyboard,
  myListingKeyboard,
  confirmDeleteKeyboard,
  favoriteCardKeyboard,
  personalAreaKeyboard,
  ratingKeyboard,

  moderationKeyboard,
  rejectReasonsKeyboard,
  adminEditFieldsKeyboard,
  adminPanelKeyboard,
  adminCategoriesKeyboard,
  broadcastConfirmKeyboard,
  backToPanelKeyboard,
  channelLinkKeyboard,
  supportKeyboard,
};
