'use strict';

/**
 * שכבת נתונים מורחבת (PRO) — נשענת על אותו client של supabase.js ולא משנה אותו.
 * כל פונקציה עמידה לכך שמיגרציית schema_v2.sql עדיין לא הורצה (מחזירה ברירת מחדל).
 */

const base = require('./supabase');

const supabase = base.supabase;
const LISTING_SELECT = base.LISTING_SELECT;

/** מריץ שאילתה ומחזיר fallback במקום לזרוק (למשל אם עמודה חדשה עדיין לא קיימת). */
async function safe(promiseFactory, fallback, context) {
  try {
    const { data, error } = await promiseFactory();
    if (error) {
      console.warn(`[db:extra:${context}] ${error.message}`);
      return fallback;
    }
    return data === null || data === undefined ? fallback : data;
  } catch (error) {
    console.warn(`[db:extra:${context}] ${error.message}`);
    return fallback;
  }
}

function daysAgoISO(days) {
  return new Date(Date.now() - days * 86400000).toISOString();
}

/* ============================================================================
 *  העדפות משתמש (שפה, התראות, פרטיות, תגים)
 * ========================================================================== */

async function updateUserFields(userId, patch) {
  return safe(
    () => supabase.from('users').update(patch).eq('id', userId).select('*').maybeSingle(),
    null,
    'updateUserFields'
  );
}

const setUserLanguage = (userId, language) => updateUserFields(userId, { language });
const setNotifications = (userId, enabled) => updateUserFields(userId, { notifications_enabled: enabled });
const setShowPhone = (userId, show) => updateUserFields(userId, { show_phone: show });
const setVerified = (userId, value) => updateUserFields(userId, { is_verified: value });
const setVip = (userId, value) => updateUserFields(userId, { is_vip: value });

async function bumpUserAdCounter(userId) {
  const user = await base.getUserById(userId);
  if (!user) return null;
  return updateUserFields(userId, {
    ads_posted_count: Number(user.ads_posted_count || 0) + 1,
    last_ad_at: new Date().toISOString(),
  });
}

async function findUser(query) {
  const raw = String(query || '').trim().replace(/^@/, '');
  if (!raw) return null;

  if (/^\d+$/.test(raw)) {
    const byTelegram = await base.getUserByTelegramId(Number(raw));
    if (byTelegram) return byTelegram;
    return base.getUserById(Number(raw));
  }

  return safe(
    () => supabase.from('users').select('*').ilike('username', raw).limit(1).maybeSingle(),
    null,
    'findUser:username'
  );
}

/** פילוח קהלים לשידור: all | active | sellers | lang:<code> */
async function segmentTelegramIds(segment = 'all') {
  if (segment === 'active') {
    const rows = await safe(
      () =>
        supabase
          .from('users')
          .select('telegram_id')
          .eq('status', 'active')
          .gte('last_seen_at', daysAgoISO(30))
          .limit(20000),
      [],
      'segment:active'
    );
    return rows.map((row) => row.telegram_id);
  }

  if (segment === 'sellers') {
    const rows = await safe(
      () => supabase.from('listings').select('user_id').neq('status', 'deleted').limit(20000),
      [],
      'segment:sellers'
    );
    const ids = [...new Set(rows.map((row) => row.user_id))];
    if (!ids.length) return [];
    const users = await safe(
      () => supabase.from('users').select('telegram_id').in('id', ids).eq('status', 'active'),
      [],
      'segment:sellers:users'
    );
    return users.map((row) => row.telegram_id);
  }

  if (segment && segment.startsWith('lang:')) {
    const lang = segment.slice(5);
    const rows = await safe(
      () =>
        supabase.from('users').select('telegram_id').eq('status', 'active').eq('language', lang).limit(20000),
      [],
      'segment:lang'
    );
    return rows.map((row) => row.telegram_id);
  }

  return base.getAllActiveTelegramIds();
}

/* ============================================================================
 *  התראות / חיפושים שמורים
 * ========================================================================== */

async function listSavedSearches(userId) {
  return safe(
    () =>
      supabase
        .from('saved_searches')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false }),
    [],
    'listSavedSearches'
  );
}

async function addSavedSearch(userId, filters, title) {
  return safe(
    () =>
      supabase
        .from('saved_searches')
        .insert({
          user_id: userId,
          title: title || '',
          q: filters.q || null,
          category_id: filters.categoryId || null,
          location: filters.location || null,
          min_price: Number.isFinite(filters.minPrice) ? filters.minPrice : null,
          max_price: Number.isFinite(filters.maxPrice) ? filters.maxPrice : null,
          free_only: Boolean(filters.freeOnly),
        })
        .select('*')
        .single(),
    null,
    'addSavedSearch'
  );
}

async function deleteSavedSearch(userId, id) {
  await safe(
    () => supabase.from('saved_searches').delete().eq('id', id).eq('user_id', userId),
    null,
    'deleteSavedSearch'
  );
  return true;
}

async function listActiveSavedSearches(limit = 2000) {
  return safe(
    () =>
      supabase
        .from('saved_searches')
        .select('*, user:users ( id, telegram_id, language, notifications_enabled, status )')
        .eq('is_active', true)
        .limit(limit),
    [],
    'listActiveSavedSearches'
  );
}

async function touchSavedSearch(id, hits) {
  return safe(
    () =>
      supabase
        .from('saved_searches')
        .update({ hits_count: hits, last_hit_at: new Date().toISOString() })
        .eq('id', id)
        .select('id')
        .maybeSingle(),
    null,
    'touchSavedSearch'
  );
}

/* ============================================================================
 *  דיווחים
 * ========================================================================== */

async function addReport({ listingId, reporterId, reason, note }) {
  const inserted = await safe(
    () =>
      supabase
        .from('reports')
        .insert({ listing_id: listingId, reporter_id: reporterId, reason, note: note || null })
        .select('*')
        .single(),
    null,
    'addReport'
  );

  if (!inserted) return null;

  const listing = await base.getListing(listingId);
  if (listing) {
    await safe(
      () =>
        supabase
          .from('listings')
          .update({ report_count: Number(listing.report_count || 0) + 1 })
          .eq('id', listingId)
          .select('id')
          .maybeSingle(),
      null,
      'addReport:counter'
    );
  }
  return inserted;
}

async function hasReported(listingId, reporterId) {
  const row = await safe(
    () =>
      supabase
        .from('reports')
        .select('id')
        .eq('listing_id', listingId)
        .eq('reporter_id', reporterId)
        .maybeSingle(),
    null,
    'hasReported'
  );
  return Boolean(row);
}

async function listOpenReports(limit = 10) {
  return safe(
    () =>
      supabase
        .from('reports')
        .select('*, listing:listings ( id, title, status, user_id, views_count, report_count )')
        .eq('status', 'open')
        .order('created_at', { ascending: true })
        .limit(limit),
    [],
    'listOpenReports'
  );
}

async function resolveReport(id, status, adminId) {
  return safe(
    () =>
      supabase
        .from('reports')
        .update({ status, handled_by: adminId, handled_at: new Date().toISOString() })
        .eq('id', id)
        .select('*')
        .maybeSingle(),
    null,
    'resolveReport'
  );
}

/* ============================================================================
 *  יומן פעולות אדמין
 * ========================================================================== */

async function logAudit({ adminId, adminName, action, targetType, targetId, details }) {
  return safe(
    () =>
      supabase
        .from('admin_audit')
        .insert({
          admin_id: adminId,
          admin_name: adminName || null,
          action,
          target_type: targetType || null,
          target_id: targetId ? String(targetId) : null,
          details: details || {},
        })
        .select('id')
        .maybeSingle(),
    null,
    'logAudit'
  );
}

async function listAudit(limit = 15) {
  return safe(
    () => supabase.from('admin_audit').select('*').order('created_at', { ascending: false }).limit(limit),
    [],
    'listAudit'
  );
}

/* ============================================================================
 *  מילים חסומות
 * ========================================================================== */

async function listBlockedWords() {
  return safe(
    () => supabase.from('blocked_words').select('*').order('word', { ascending: true }),
    [],
    'listBlockedWords'
  );
}

async function addBlockedWord(word, severity, adminId) {
  return safe(
    () =>
      supabase
        .from('blocked_words')
        .upsert({ word: word.toLowerCase(), severity: severity || 'block', created_by: adminId }, { onConflict: 'word' })
        .select('*')
        .maybeSingle(),
    null,
    'addBlockedWord'
  );
}

async function deleteBlockedWord(id) {
  await safe(() => supabase.from('blocked_words').delete().eq('id', id), null, 'deleteBlockedWord');
  return true;
}

/* ============================================================================
 *  הגדרות מערכת
 * ========================================================================== */

const SETTING_DEFAULTS = {
  auto_approve: false,
  maintenance_mode: false,
  max_ads_per_day: 5,
  max_alerts: 10,
  require_photo: true,
  listing_ttl_days: 60,
  welcome_bonus: true,
};

async function getSettings() {
  const rows = await safe(() => supabase.from('app_settings').select('*'), [], 'getSettings');
  const result = { ...SETTING_DEFAULTS };
  rows.forEach((row) => {
    result[row.key] = row.value;
  });
  return result;
}

async function getSetting(key) {
  const settings = await getSettings();
  return settings[key];
}

async function setSetting(key, value, adminId) {
  return safe(
    () =>
      supabase
        .from('app_settings')
        .upsert(
          { key, value, updated_by: adminId, updated_at: new Date().toISOString() },
          { onConflict: 'key' }
        )
        .select('*')
        .maybeSingle(),
    null,
    'setSetting'
  );
}

/* ============================================================================
 *  אירועים (טלמטריה)
 * ========================================================================== */

async function logEvent(type, userId, payload) {
  return safe(
    () => supabase.from('events').insert({ type, user_id: userId || null, payload: payload || {} }).select('id').maybeSingle(),
    null,
    'logEvent'
  );
}

/* ============================================================================
 *  פידים של מודעות (גלישה חכמה)
 * ========================================================================== */

async function feed({ mode = 'newest', categoryId = null, location = null, page = 0, pageSize = 1 }) {
  const from = page * pageSize;
  const to = from + pageSize - 1;

  let query = supabase.from('listings').select(LISTING_SELECT, { count: 'exact' }).eq('status', 'approved');

  if (categoryId) query = query.eq('category_id', categoryId);
  if (location) query = query.eq('location', location);
  if (mode === 'free') query = query.eq('price_type', 'free');
  if (mode === 'deals') query = query.gt('price', 0).lte('price', 300);

  if (mode === 'trending') {
    query = query.gte('created_at', daysAgoISO(7)).order('views_count', { ascending: false });
  } else if (mode === 'featured') {
    query = query.eq('is_featured', true).order('featured_until', { ascending: false });
  } else {
    query = query.order('bumped_at', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false });
  }

  const { data, error, count } = await query.range(from, to);
  if (error) {
    console.warn(`[db:extra:feed] ${error.message}`);
    return { items: [], total: 0 };
  }
  return { items: data || [], total: count || 0 };
}

async function listingsBySeller(userId, page = 0, pageSize = 1) {
  const from = page * pageSize;
  const to = from + pageSize - 1;
  const { data, error, count } = await supabase
    .from('listings')
    .select(LISTING_SELECT, { count: 'exact' })
    .eq('user_id', userId)
    .eq('status', 'approved')
    .order('created_at', { ascending: false })
    .range(from, to);

  if (error) {
    console.warn(`[db:extra:listingsBySeller] ${error.message}`);
    return { items: [], total: 0 };
  }
  return { items: data || [], total: count || 0 };
}

/** מודעות דומות: אותה קטגוריה, טווח מחיר ±40%, לא אותה מודעה. */
async function similarListings(listing, limit = 3) {
  const price = Number(listing.price || 0);
  let query = supabase
    .from('listings')
    .select(LISTING_SELECT)
    .eq('status', 'approved')
    .neq('id', listing.id)
    .limit(limit);

  if (listing.category_id) query = query.eq('category_id', listing.category_id);
  if (price > 0) query = query.gte('price', price * 0.6).lte('price', price * 1.4);

  const { data, error } = await query.order('views_count', { ascending: false });
  if (error) {
    console.warn(`[db:extra:similarListings] ${error.message}`);
    return [];
  }
  return data || [];
}

async function setFeatured(listingId, days) {
  const until = new Date(Date.now() + days * 86400000).toISOString();
  return safe(
    () =>
      supabase
        .from('listings')
        .update({ is_featured: days > 0, featured_until: days > 0 ? until : null })
        .eq('id', listingId)
        .select(LISTING_SELECT)
        .maybeSingle(),
    null,
    'setFeatured'
  );
}

async function countUserListingsSince(userId, hours = 24) {
  const { count, error } = await supabase
    .from('listings')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', new Date(Date.now() - hours * 3600000).toISOString());

  if (error) {
    console.warn(`[db:extra:countUserListingsSince] ${error.message}`);
    return 0;
  }
  return count || 0;
}

async function findDuplicateListing(userId, title) {
  const row = await safe(
    () =>
      supabase
        .from('listings')
        .select('id, title, status')
        .eq('user_id', userId)
        .ilike('title', String(title || '').trim())
        .in('status', ['pending', 'approved'])
        .limit(1)
        .maybeSingle(),
    null,
    'findDuplicateListing'
  );
  return row;
}

/* ============================================================================
 *  אנליטיקס
 * ========================================================================== */

async function countSince(table, column, days) {
  const { count, error } = await supabase
    .from(table)
    .select('*', { count: 'exact', head: true })
    .gte(column, daysAgoISO(days));

  if (error) {
    console.warn(`[db:extra:countSince:${table}] ${error.message}`);
    return 0;
  }
  return count || 0;
}

async function dailySeries(table, column, days = 7) {
  const rows = await safe(
    () => supabase.from(table).select(column).gte(column, daysAgoISO(days)).limit(10000),
    [],
    `dailySeries:${table}`
  );

  const buckets = new Map();
  for (let i = days - 1; i >= 0; i -= 1) {
    const day = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    buckets.set(day, 0);
  }
  rows.forEach((row) => {
    const day = String(row[column]).slice(0, 10);
    if (buckets.has(day)) buckets.set(day, buckets.get(day) + 1);
  });
  return [...buckets.entries()].map(([day, value]) => ({ day, value }));
}

async function topCategories(limit = 5) {
  const rows = await safe(
    () =>
      supabase
        .from('v_category_stats')
        .select('*')
        .order('active_listings', { ascending: false })
        .limit(limit),
    [],
    'topCategories'
  );
  return rows;
}

async function topSellers(limit = 5) {
  const rows = await safe(
    () => supabase.from('v_top_sellers').select('*').order('sold_listings', { ascending: false }).limit(limit),
    [],
    'topSellers'
  );
  return rows;
}

async function languageBreakdown() {
  const rows = await safe(
    () => supabase.from('users').select('language').limit(20000),
    [],
    'languageBreakdown'
  );
  const map = new Map();
  rows.forEach((row) => {
    const lang = row.language || 'he';
    map.set(lang, (map.get(lang) || 0) + 1);
  });
  return [...map.entries()].sort((a, b) => b[1] - a[1]).map(([lang, count]) => ({ lang, count }));
}

async function analyticsSnapshot() {
  const [metrics, users7, users30, listings7, listings30, approved7, sold7, reportsOpen, cats, sellers, langs] =
    await Promise.all([
      base.getMetrics(),
      countSince('users', 'created_at', 7),
      countSince('users', 'created_at', 30),
      countSince('listings', 'created_at', 7),
      countSince('listings', 'created_at', 30),
      countSince('listings', 'approved_at', 7),
      countSince('listings', 'sold_at', 7),
      base.countRows('reports', { status: 'open' }).catch(() => 0),
      topCategories(5),
      topSellers(5),
      languageBreakdown(),
    ]);

  const approvalRate = listings30 ? Math.round((metrics.approved / Math.max(metrics.approved + metrics.rejected, 1)) * 100) : 0;

  return {
    metrics,
    users7,
    users30,
    listings7,
    listings30,
    approved7,
    sold7,
    reportsOpen,
    approvalRate,
    topCategories: cats,
    topSellers: sellers,
    languages: langs,
  };
}

/* ============================================================================
 *  ייצוא CSV
 * ========================================================================== */

function toCsv(rows, columns) {
  const escape = (value) => {
    if (value === null || value === undefined) return '';
    const text = String(value).replace(/"/g, '""');
    return /[",\n;]/.test(text) ? `"${text}"` : text;
  };
  const header = columns.join(',');
  const body = rows.map((row) => columns.map((column) => escape(row[column])).join(','));
  return ['\uFEFF' + header, ...body].join('\n');
}

async function exportUsersCsv(limit = 5000) {
  const rows = await safe(
    () =>
      supabase
        .from('users')
        .select('id, telegram_id, full_name, username, language, status, rating_sum, rating_count, created_at')
        .order('id', { ascending: true })
        .limit(limit),
    [],
    'exportUsersCsv'
  );
  return toCsv(rows, [
    'id',
    'telegram_id',
    'full_name',
    'username',
    'language',
    'status',
    'rating_sum',
    'rating_count',
    'created_at',
  ]);
}

async function exportListingsCsv(limit = 5000) {
  const rows = await safe(
    () =>
      supabase
        .from('listings')
        .select('id, user_id, title, price, price_type, category_id, location, status, views_count, contacts_count, created_at')
        .order('id', { ascending: true })
        .limit(limit),
    [],
    'exportListingsCsv'
  );
  return toCsv(rows, [
    'id',
    'user_id',
    'title',
    'price',
    'price_type',
    'category_id',
    'location',
    'status',
    'views_count',
    'contacts_count',
    'created_at',
  ]);
}

/* ============================================================================
 *  ספירת מודעות לפי קטגוריה (לתפריט הגלישה)
 * ========================================================================== */

async function categoryCounts() {
  const rows = await safe(
    () => supabase.from('listings').select('category_id').eq('status', 'approved').limit(20000),
    [],
    'categoryCounts'
  );
  const map = new Map();
  rows.forEach((row) => {
    if (!row.category_id) return;
    map.set(row.category_id, (map.get(row.category_id) || 0) + 1);
  });
  return map;
}

module.exports = {
  safe,
  daysAgoISO,

  updateUserFields,
  setUserLanguage,
  setNotifications,
  setShowPhone,
  setVerified,
  setVip,
  bumpUserAdCounter,
  findUser,
  segmentTelegramIds,

  listSavedSearches,
  addSavedSearch,
  deleteSavedSearch,
  listActiveSavedSearches,
  touchSavedSearch,

  addReport,
  hasReported,
  listOpenReports,
  resolveReport,

  logAudit,
  listAudit,

  listBlockedWords,
  addBlockedWord,
  deleteBlockedWord,

  SETTING_DEFAULTS,
  getSettings,
  getSetting,
  setSetting,

  logEvent,

  feed,
  listingsBySeller,
  similarListings,
  setFeatured,
  countUserListingsSince,
  findDuplicateListing,

  countSince,
  dailySeries,
  topCategories,
  topSellers,
  languageBreakdown,
  analyticsSnapshot,

  toCsv,
  exportUsersCsv,
  exportListingsCsv,
  categoryCounts,
};
