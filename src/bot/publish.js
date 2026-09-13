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

/** האם הפוסט בערוץ נשלח כתמונה בודדת עם caption. */
function isSinglePhotoPost(listing) {
  const photos = listing.photos || [];
  return photos.length === 1;
}

/** מפרסם מודעה בצ'אט (ערוץ) בודד. מחזיר {chat_id, message_id, media_message_ids} או null בכשל. */
async function publishToChat(telegram, chatId, listing, { text, keyboard, photos }) {
  try {
    let mainMessageId = null;
    let mediaMessageIds = [];

    if (photos.length === 1) {
      const message = await telegram.sendPhoto(chatId, photos[0], {
        caption: text,
        parse_mode: 'HTML',
        reply_markup: keyboard.reply_markup,
      });
      mainMessageId = message.message_id;
    } else if (photos.length > 1) {
      const album = await telegram.sendMediaGroup(
        chatId,
        photos.slice(0, env.MAX_PHOTOS).map((fileId) => ({ type: 'photo', media: fileId }))
      );
      mediaMessageIds = album.map((message) => message.message_id);
      const message = await telegram.sendMessage(chatId, text, {
        parse_mode: 'HTML',
        reply_markup: keyboard.reply_markup,
        reply_to_message_id: mediaMessageIds[0],
        allow_sending_without_reply: true,
        disable_web_page_preview: true,
      });
      mainMessageId = message.message_id;
    } else {
      const message = await telegram.sendMessage(chatId, text, {
        parse_mode: 'HTML',
        reply_markup: keyboard.reply_markup,
        disable_web_page_preview: true,
      });
      mainMessageId = message.message_id;
    }

    return { chat_id: chatId, message_id: mainMessageId, media_message_ids: mediaMessageIds };
  } catch (error) {
    console.error(`[publish] publish to ${chatId} failed:`, error.message);
    return null;
  }
}

/**
 * מפרסם מודעה בכל ערוצי הפרסום המוגדרים (ניהול ערוצים בפאנל, עם נפילה ל-CHANNEL_ID).
 * 1 תמונה  -> sendPhoto עם caption + כפתורים.
 * 2+ תמונות -> sendMediaGroup (אלבום) + הודעת טקסט עם הכפתורים.
 * 0 תמונות -> הודעת טקסט בלבד.
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
  const keyboard = kb.channelKeyboard(listing.id);
  const photos = listing.photos || [];

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
      if (isSinglePhotoPost(listing)) {
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
