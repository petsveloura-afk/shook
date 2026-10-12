'use strict';

/**
 * שירות הפרסום בערוץ — פרסום, סימון "נמכר", הסרה והקפצה.
 * משותף ל-handlers/admin.js ול-handlers/user.js (ללא תלות מעגלית).
 */

const env = require('../config/env');
const db = require('../db/supabase');
const fmt = require('./formatters');
const kb = require('./keyboards');
const destinations = require('../services/destinations');

/** מגבלת טלגרם ל-caption של מדיה. */
const CAPTION_LIMIT = 1024;

/** האם הפוסט בערוץ נשלח כתמונה בודדת עם caption. */
function isSinglePhotoPost(listing) {
  const photos = listing.photos || [];
  return photos.length === 1;
}

/**
 * מפרסם מודעה בצ'אט (ערוץ) בודד.
 * כל פוסט הוא הודעה אחת, והכפתורים מחוברים אליה ישירות:
 *  - יש תמונה (אחת או יותר) -> sendPhoto עם התמונה הראשונה + caption + כפתורים.
 *  - אין תמונות, או שהטקסט ארוך ממגבלת ה-caption -> הודעת טקסט + כפתורים.
 * מחזיר {chat_id, message_id, media_message_ids, caption_album, kind} או null בכשל.
 */
async function publishToChat(telegram, chatId, listing, { text, keyboard, photos }) {
  try {
    let message;
    let kind;

    if (photos.length >= 1 && text.length <= CAPTION_LIMIT) {
      message = await telegram.sendPhoto(chatId, photos[0], {
        caption: text,
        parse_mode: 'HTML',
        reply_markup: keyboard.reply_markup,
      });
      kind = 'photo';
    } else {
      message = await telegram.sendMessage(chatId, text, {
        parse_mode: 'HTML',
        reply_markup: keyboard.reply_markup,
        disable_web_page_preview: true,
      });
      kind = 'text';
    }

    return {
      chat_id: chatId,
      message_id: message.message_id,
      media_message_ids: [],
      caption_album: false,
      kind,
    };
  } catch (error) {
    console.error(`[publish] publish to ${chatId} failed:`, error.message);
    return null;
  }
}

/**
 * מפרסם מודעה בכל ערוצי הפרסום המוגדרים (ניהול ערוצים בפאנל, עם נפילה ל-CHANNEL_ID).
 * יש תמונה -> sendPhoto עם caption + כפתורים באותה הודעה.
 * 0 תמונות -> הודעת טקסט עם כפתורים.
 */
async function publishListing(telegram, listingId) {
  const listing = await db.getListing(listingId);
  if (!listing) throw new Error(`listing ${listingId} not found`);

  const channelIds = await destinations.getChannelIds();
  if (!channelIds.length) {
    throw new Error('לא הוגדר ערוץ פרסום. הגדר CHANNEL_ID או הוסף ערוץ דרך "🗂️ ערוצים וקבוצות" בפאנל הניהול.');
  }

  const approvedAt = listing.approved_at || new Date().toISOString();
  const enriched = { ...listing, approved_at: approvedAt };
  const text = fmt.channelPost(enriched);
  const photos = listing.photos || [];
  const keyboard = kb.channelKeyboard(listing.id, photos.length);

  const posts = [];
  for (const chatId of channelIds) {
    const post = await publishToChat(telegram, chatId, listing, { text, keyboard, photos });
    if (post) posts.push(post);
  }

  if (!posts.length) throw new Error('הפרסום נכשל בכל ערוצי הפרסום המוגדרים.');

  const primary = posts[0];
  return db.updateListingTolerant(
    listing.id,
    {
      status: 'approved',
      reject_reason: null,
      approved_at: approvedAt,
      channel_message_id: primary.message_id,
      channel_media_message_ids: primary.media_message_ids,
      channel_posts: posts,
    },
    ['channel_posts']
  );
}

/** מאחזר את רשימת הפוסטים של מודעה (תמיכה בריבוי ערוצים + נפילה למבנה הישן). */
function resolvePosts(listing) {
  if (Array.isArray(listing.channel_posts) && listing.channel_posts.length) return listing.channel_posts;
  if (listing.channel_message_id && env.CHANNEL_ID) {
    return [
      {
        chat_id: env.CHANNEL_ID,
        message_id: listing.channel_message_id,
        media_message_ids: listing.channel_media_message_ids || [],
      },
    ];
  }
  return [];
}

/** מעדכן את הפוסט/ים בערוצים עם תג "נמכר" ומסיר את כפתורי הרכישה. */
async function markSoldInChannel(telegram, listing) {
  const posts = resolvePosts(listing);
  if (!posts.length) return null;

  const text = fmt.channelPost(listing, { sold: true });
  const keyboard = { inline_keyboard: [[{ text: '🤖 לפרסום מודעה דרך הבוט', url: env.botLink('publish') }]] };

  for (const post of posts) {
    if (!post.chat_id || !post.message_id) continue;
    try {
      const hasAlbum = post.media_message_ids && post.media_message_ids.length > 0;

      if (post.kind === 'photo') {
        // פוסט חדש: תמונה אחת עם caption וכפתורים באותה הודעה.
        await telegram.editMessageCaption(post.chat_id, post.message_id, undefined, text, {
          parse_mode: 'HTML',
          reply_markup: keyboard,
        });
      } else if (post.kind === 'text') {
        await telegram.editMessageText(post.chat_id, post.message_id, undefined, text, {
          parse_mode: 'HTML',
          reply_markup: keyboard,
          disable_web_page_preview: true,
        });
      } else if (hasAlbum && post.caption_album) {
        // תאימות לאחור: פוסטים ישנים שפורסמו כאלבום + הודעת כפתורים נפרדת.
        await telegram.editMessageCaption(post.chat_id, post.media_message_ids[0], undefined, text, {
          parse_mode: 'HTML',
        });
        await telegram.editMessageText(post.chat_id, post.message_id, undefined, '🔴 נמכר', {
          parse_mode: 'HTML',
          reply_markup: keyboard,
        });
      } else if (isSinglePhotoPost(listing) && !hasAlbum) {
        // תאימות לאחור: פוסטים ישנים של תמונה בודדת.
        await telegram.editMessageCaption(post.chat_id, post.message_id, undefined, text, {
          parse_mode: 'HTML',
          reply_markup: keyboard,
        });
      } else {
        await telegram.editMessageText(post.chat_id, post.message_id, undefined, text, {
          parse_mode: 'HTML',
          reply_markup: keyboard,
          disable_web_page_preview: true,
        });
      }
    } catch (error) {
      console.error(`[publish] markSoldInChannel failed for ${post.chat_id}:`, error.message);
    }
  }
  return true;
}

/** מוחק את הפוסט/ים (וגם את האלבומים) מכל הערוצים שבהם המודעה פורסמה. */
async function removeFromChannel(telegram, listing) {
  const posts = resolvePosts(listing);
  if (!posts.length) return false;

  for (const post of posts) {
    const ids = [];
    if (post.message_id) ids.push(post.message_id);
    (post.media_message_ids || []).forEach((id) => ids.push(id));

    for (const messageId of ids) {
      try {
        await telegram.deleteMessage(post.chat_id, messageId);
      } catch (error) {
        // הודעות מעל 48 שעות לא ניתנות למחיקה — לא נכשלים על כך.
        console.warn(`[publish] deleteMessage ${messageId} in ${post.chat_id} failed: ${error.message}`);
      }
    }
  }
  return true;
}

/** הקפצת מודעה: מסירים את הפוסט הקיים ומפרסמים מחדש בראש הערוץ/ים. */
async function bumpListing(telegram, listingId) {
  const listing = await db.getListing(listingId);
  if (!listing) throw new Error(`listing ${listingId} not found`);

  await removeFromChannel(telegram, listing);
  await db.updateListingTolerant(
    listing.id,
    {
      channel_message_id: null,
      channel_media_message_ids: [],
      channel_posts: [],
      bumped_at: new Date().toISOString(),
    },
    ['channel_posts']
  );
  return publishListing(telegram, listing.id);
}

module.exports = {
  publishListing,
  markSoldInChannel,
  removeFromChannel,
  bumpListing,
  isSinglePhotoPost,
};
