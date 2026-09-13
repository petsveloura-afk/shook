'use strict';

/**
 * שכבת גישה לנתונים (Supabase / PostgreSQL).
 * כל הפניות ל-DB בפרויקט עוברות דרך הקובץ הזה.
 */

const { createClient } = require('@supabase/supabase-js');
const env = require('../config/env');

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { headers: { 'x-application-name': 'pashpashuk-bot' } },
});

const LISTING_SELECT = `
  *,
  category:categories ( id, name_he, emoji, slug ),
  seller:users ( id, telegram_id, full_name, username, phone_number, rating_sum, rating_count, status )
`;

/** מפרק תשובת Supabase וזורק שגיאה קריאה במקרה של כשל. */
function unwrap({ data, error }, context) {
  if (error) {
    const err = new Error(`[db:${context}] ${error.message || 'unknown error'}`);
    err.details = error.details || null;
    err.code = error.code || null;
    throw err;
  }
  return data;
}

/** מנקה קלט חיפוש מתווים ששוברים את תחביר ה-or() של PostgREST. */
function sanitizeSearchTerm(term) {
  return String(term || '')
    .replace(/[,()%*\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

/* ============================================================================
 *  USERS
 * ========================================================================== */

async function upsertUser(from) {
  const payload = {
    telegram_id: from.id,
    full_name: [from.first_name, from.last_name].filter(Boolean).join(' ') || 'משתמש',
    username: from.username || null,
    last_seen_at: new Date().toISOString(),
  };

  const data = unwrap(
    await supabase
      .from('users')
      .upsert(payload, { onConflict: 'telegram_id' })
      .select('*')
      .single(),
    'upsertUser'
  );
  return data;
}

async function getUserByTelegramId(telegramId) {
  return unwrap(
    await supabase.from('users').select('*').eq('telegram_id', telegramId).maybeSingle(),
    'getUserByTelegramId'
  );
}

async function getUserById(id) {
  return unwrap(await supabase.from('users').select('*').eq('id', id).maybeSingle(), 'getUserById');
}

async function setUserStatus(userId, status, reason = null) {
  return unwrap(
    await supabase
      .from('users')
      .update({ status, ban_reason: reason })
      .eq('id', userId)
      .select('*')
      .maybeSingle(),
    'setUserStatus'
  );
}

async function setUserPhone(userId, phone) {
  return unwrap(
    await supabase
      .from('users')
      .update({ phone_number: phone })
      .eq('id', userId)
      .select('*')
      .maybeSingle(),
    'setUserPhone'
  );
}

/** מחזיר את כל מזהי הטלגרם הפעילים — לשידור המוני. */
async function getAllActiveTelegramIds() {
  const rows = [];
  const pageSize = 1000;
  for (let page = 0; ; page += 1) {
    const chunk = unwrap(
      await supabase
        .from('users')
        .select('telegram_id')
        .eq('status', 'active')
        .order('id', { ascending: true })
        .range(page * pageSize, page * pageSize + pageSize - 1),
      'getAllActiveTelegramIds'
    );
    rows.push(...(chunk || []).map((row) => row.telegram_id));
    if (!chunk || chunk.length < pageSize) break;
  }
  return rows;
}

/* ============================================================================
 *  SESSIONS (FSM state persistence)
 * ========================================================================== */

async function getSession(key) {
  const row = unwrap(
    await supabase.from('sessions').select('value').eq('key', key).maybeSingle(),
    'getSession'
  );
  return row ? row.value || {} : {};
}

async function saveSession(key, value) {
  return unwrap(
    await supabase
      .from('sessions')
      .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' })
      .select('key')
      .maybeSingle(),
    'saveSession'
  );
}

async function deleteSession(key) {
  unwrap(await supabase.from('sessions').delete().eq('key', key), 'deleteSession');
  return true;
}

/* ============================================================================
 *  BOT DESTINATIONS (ערוצי פרסום + קבוצות אישור מנהלים — ניתן לניהול מהבוט)
 * ========================================================================== */

/**
 * מחזיר את כל היעדים מתפקיד מסוים ('channel' | 'admin_group').
 * לא זורק אם הטבלה עוד לא קיימת (המיגרציה schema_channels.sql לא הורצה) —
 * מחזיר [] כדי שהקוד הקורא יפול חזרה בשקט למשתני הסביבה.
 */
async function listDestinations(role) {
  try {
    return (
      unwrap(
        await supabase
          .from('bot_destinations')
          .select('*')
          .eq('role', role)
          .order('id', { ascending: true }),
        'listDestinations'
      ) || []
    );
  } catch (error) {
    console.warn(
      `[db] listDestinations('${role}') unavailable — הרץ את schema_channels.sql? (${error.message})`
    );
    return [];
  }
}

/** כל היעדים המוגדרים (לתצוגה בפאנל הניהול). */
async function listAllDestinations() {
  try {
    return (
      unwrap(
        await supabase
          .from('bot_destinations')
          .select('*')
          .order('role', { ascending: true })
          .order('id', { ascending: true }),
        'listAllDestinations'
      ) || []
    );
  } catch (error) {
    console.warn('[db] listAllDestinations unavailable:', error.message);
    return [];
  }
}

/** מוסיף/מעדכן יעד (ערוץ או קבוצת אישור) לפי chat_id + role. */
async function upsertDestination({ chat_id, chat_title, chat_type, role, added_by }) {
  return unwrap(
    await supabase
      .from('bot_destinations')
      .upsert(
        { chat_id, chat_title: chat_title || null, chat_type: chat_type || null, role, added_by: added_by || null },
        { onConflict: 'chat_id,role' }
      )
      .select('*')
      .maybeSingle(),
    'upsertDestination'
  );
}

async function removeDestination(chatId, role) {
  unwrap(
    await supabase.from('bot_destinations').delete().eq('chat_id', chatId).eq('role', role),
    'removeDestination'
  );
  return true;
}

/* ============================================================================
 *  CATEGORIES
 * ========================================================================== */

async function listCategories() {
  return (
    unwrap(
      await supabase
        .from('categories')
        .select('*')
        .order('sort_order', { ascending: true })
        .order('id', { ascending: true }),
      'listCategories'
    ) || []
  );
}

async function getCategory(id) {
  return unwrap(
    await supabase.from('categories').select('*').eq('id', id).maybeSingle(),
    'getCategory'
  );
}

async function addCategory({ name_he, emoji, slug, sort_order }) {
  return unwrap(
    await supabase
      .from('categories')
      .insert({
        name_he,
        emoji: emoji || '📦',
        slug,
        sort_order: Number.isFinite(sort_order) ? sort_order : 500,
      })
      .select('*')
      .single(),
    'addCategory'
  );
}

async function deleteCategory(id) {
  unwrap(await supabase.from('categories').delete().eq('id', id), 'deleteCategory');
  return true;
}

/* ============================================================================
 *  LISTINGS
 * ========================================================================== */

async function createListing(payload) {
  return unwrap(
    await supabase.from('listings').insert(payload).select(LISTING_SELECT).single(),
    'createListing'
  );
}

async function getListing(id) {
  return unwrap(
    await supabase.from('listings').select(LISTING_SELECT).eq('id', id).maybeSingle(),
    'getListing'
  );
}

async function updateListing(id, patch) {
  return unwrap(
    await supabase.from('listings').update(patch).eq('id', id).select(LISTING_SELECT).maybeSingle(),
    'updateListing'
  );
}

/**
 * כמו updateListing, אבל סובלני לעמודות חדשות שטרם נוצרו ב-DB (למשל channel_posts
 * לפני הרצת schema_channels.sql): במקרה של שגיאת "undefined_column" (42703),
 * מנסה שוב בלי השדה שאינו קיים, כדי לא להפיל את כל תהליך הפרסום/עדכון.
 */
async function updateListingTolerant(id, patch, optionalKeys = []) {
  try {
    return await updateListing(id, patch);
  } catch (error) {
    if (error && error.code === '42703' && optionalKeys.length) {
      const fallbackPatch = { ...patch };
      optionalKeys.forEach((key) => delete fallbackPatch[key]);
      console.warn(
        `[db] updateListing: עמודה חסרה (${error.message}) — נשמר בלי ${optionalKeys.join(', ')}. הרץ מיגרציה עדכנית.`
      );
      return updateListing(id, fallbackPatch);
    }
    throw error;
  }
}

async function incrementListingCounter(id, field) {
  const current = unwrap(
    await supabase.from('listings').select(`id, ${field}`).eq('id', id).maybeSingle(),
    'incrementListingCounter:read'
  );
  if (!current) return null;
  const next = Number(current[field] || 0) + 1;
  return unwrap(
    await supabase
      .from('listings')
      .update({ [field]: next })
      .eq('id', id)
      .select(`id, ${field}`)
      .maybeSingle(),
    'incrementListingCounter:write'
  );
}

const incrementViews = (id) => incrementListingCounter(id, 'views_count');
const incrementContacts = (id) => incrementListingCounter(id, 'contacts_count');

/**
 * חיפוש/סינון במודעות המאושרות.
 * filters: { q, categoryId, location, minPrice, maxPrice, freeOnly }
 */
async function searchListings(filters = {}, page = 0, pageSize = 1) {
  const from = page * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from('listings')
    .select(LISTING_SELECT, { count: 'exact' })
    .eq('status', 'approved');

  const term = sanitizeSearchTerm(filters.q);
  if (term) query = query.or(`title.ilike.%${term}%,description.ilike.%${term}%`);
  if (filters.categoryId) query = query.eq('category_id', filters.categoryId);
  if (filters.location) query = query.eq('location', filters.location);
  if (filters.freeOnly) query = query.eq('price_type', 'free');
  if (Number.isFinite(filters.minPrice)) query = query.gte('price', filters.minPrice);
  if (Number.isFinite(filters.maxPrice)) query = query.lte('price', filters.maxPrice);

  const { data, error, count } = await query
    .order('bumped_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .range(from, to);

  unwrap({ data, error }, 'searchListings');
  return { items: data || [], total: count || 0 };
}

/** המודעות של משתמש מסוים (ללא מודעות שנמחקו), עם עימוד. */
async function listUserListings(userId, page = 0, pageSize = 1, statuses = null) {
  const from = page * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from('listings')
    .select(LISTING_SELECT, { count: 'exact' })
    .eq('user_id', userId);

  if (statuses && statuses.length) query = query.in('status', statuses);
  else query = query.neq('status', 'deleted');

  const { data, error, count } = await query
    .order('created_at', { ascending: false })
    .range(from, to);

  unwrap({ data, error }, 'listUserListings');
  return { items: data || [], total: count || 0 };
}

async function listPendingListings(limit = 20) {
  return (
    unwrap(
      await supabase
        .from('listings')
        .select(LISTING_SELECT)
        .eq('status', 'pending')
        .order('created_at', { ascending: true })
        .limit(limit),
      'listPendingListings'
    ) || []
  );
}

/* ============================================================================
 *  FAVORITES
 * ========================================================================== */

async function addFavorite(userId, listingId) {
  unwrap(
    await supabase
      .from('favorites')
      .upsert({ user_id: userId, listing_id: listingId }, { onConflict: 'user_id,listing_id' }),
    'addFavorite'
  );
  return true;
}

async function removeFavorite(userId, listingId) {
  unwrap(
    await supabase.from('favorites').delete().eq('user_id', userId).eq('listing_id', listingId),
    'removeFavorite'
  );
  return true;
}

async function isFavorite(userId, listingId) {
  const row = unwrap(
    await supabase
      .from('favorites')
      .select('listing_id')
      .eq('user_id', userId)
      .eq('listing_id', listingId)
      .maybeSingle(),
    'isFavorite'
  );
  return Boolean(row);
}

async function listFavorites(userId, page = 0, pageSize = 1) {
  const from = page * pageSize;
  const to = from + pageSize - 1;

  const { data, error, count } = await supabase
    .from('favorites')
    .select(`listing_id, created_at, listing:listings ( ${LISTING_SELECT} )`, { count: 'exact' })
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .range(from, to);

  unwrap({ data, error }, 'listFavorites');

  const items = (data || [])
    .map((row) => row.listing)
    .filter((listing) => listing && listing.status !== 'deleted');

  return { items, total: count || 0 };
}

/* ============================================================================
 *  RATINGS
 * ========================================================================== */

async function hasRated(listingId, raterId) {
  const row = unwrap(
    await supabase
      .from('ratings')
      .select('id')
      .eq('listing_id', listingId)
      .eq('rater_id', raterId)
      .maybeSingle(),
    'hasRated'
  );
  return Boolean(row);
}

/** שומר דירוג ומעדכן את הצבירה אצל המוכר. מחזיר false אם כבר דורג. */
async function addRating({ listingId, sellerId, raterId, stars }) {
  if (await hasRated(listingId, raterId)) return false;

  unwrap(
    await supabase
      .from('ratings')
      .insert({ listing_id: listingId, seller_id: sellerId, rater_id: raterId, stars }),
    'addRating'
  );

  const seller = await getUserById(sellerId);
  if (seller) {
    unwrap(
      await supabase
        .from('users')
        .update({
          rating_sum: Number(seller.rating_sum || 0) + Number(stars),
          rating_count: Number(seller.rating_count || 0) + 1,
        })
        .eq('id', sellerId),
      'addRating:aggregate'
    );
  }
  return true;
}

/* ============================================================================
 *  METRICS / ADMIN
 * ========================================================================== */

async function countRows(table, filters = {}) {
  let query = supabase.from(table).select('*', { count: 'exact', head: true });
  Object.entries(filters).forEach(([key, value]) => {
    query = Array.isArray(value) ? query.in(key, value) : query.eq(key, value);
  });
  const { error, count } = await query;
  unwrap({ data: null, error }, `countRows:${table}`);
  return count || 0;
}

async function getMetrics() {
  const [totalUsers, bannedUsers, pending, approved, sold, rejected, categories] = await Promise.all([
    countRows('users'),
    countRows('users', { status: 'banned' }),
    countRows('listings', { status: 'pending' }),
    countRows('listings', { status: 'approved' }),
    countRows('listings', { status: 'sold' }),
    countRows('listings', { status: 'rejected' }),
    countRows('categories'),
  ]);

  return {
    totalUsers,
    bannedUsers,
    activeUsers: totalUsers - bannedUsers,
    pending,
    approved,
    sold,
    rejected,
    categories,
  };
}

async function logBroadcast({ adminId, message, sentCount, failedCount }) {
  return unwrap(
    await supabase
      .from('broadcasts')
      .insert({
        admin_id: adminId,
        message,
        sent_count: sentCount,
        failed_count: failedCount,
      })
      .select('id')
      .maybeSingle(),
    'logBroadcast'
  );
}

module.exports = {
  supabase,
  LISTING_SELECT,
  sanitizeSearchTerm,

  // users
  upsertUser,
  getUserByTelegramId,
  getUserById,
  setUserStatus,
  setUserPhone,
  getAllActiveTelegramIds,

  // sessions
  getSession,
  saveSession,
  deleteSession,

  // bot destinations (channels / admin groups)
  listDestinations,
  listAllDestinations,
  upsertDestination,
  removeDestination,

  // categories
  listCategories,
  getCategory,
  addCategory,
  deleteCategory,

  // listings
  createListing,
  getListing,
  updateListing,
  updateListingTolerant,
  incrementViews,
  incrementContacts,
  searchListings,
  listUserListings,
  listPendingListings,

  // favorites
  addFavorite,
  removeFavorite,
  isFavorite,
  listFavorites,

  // ratings
  hasRated,
  addRating,

  // admin
  countRows,
  getMetrics,
  logBroadcast,
};
