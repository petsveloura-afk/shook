'use strict';

/**
 * כל הלוגיקה של המשתמש: תפריט ראשי, חיפוש וסינון, אזור אישי,
 * המודעות שלי, מועדפים, יצירת קשר, דירוג מוכרים ועדכון טלפון.
 */

const env = require('../../config/env');
const db = require('../../db/supabase');
const kb = require('../keyboards');
const fmt = require('../formatters');
const publish = require('../publish');
const createAd = require('../fsm/createAd');

const CAPTION_LIMIT = 1000;

/* --------------------------------- עזרים --------------------------------- */

function filtersOf(ctx) {
  if (!ctx.session.search) ctx.session.search = {};
  return ctx.session.search;
}

/** שולח כרטיס: תמונה + כיתוב אם אפשר, אחרת תמונה + הודעת טקסט נפרדת. */
async function sendCard(ctx, listing, text, keyboard) {
  const photos = listing.photos || [];
  const extra = { parse_mode: 'HTML', reply_markup: keyboard.reply_markup };

  if (photos.length && text.length <= CAPTION_LIMIT) {
    return ctx.replyWithPhoto(photos[0], { caption: text, ...extra });
  }
  if (photos.length) {
    await ctx.replyWithPhoto(photos[0]);
  }
  return ctx.reply(text, { ...extra, disable_web_page_preview: true });
}

async function safeDelete(ctx) {
  try {
    await ctx.deleteMessage();
  } catch (error) {
    /* אין הרשאה או שההודעה ישנה — לא קריטי */
  }
}

/* ------------------------------ תפריט ראשי ------------------------------ */

async function showWelcome(ctx) {
  const name = fmt.esc(ctx.from.first_name || 'חבר');
  return ctx.reply(
    [
      `👋 <b>שלום ${name}, ברוך הבא לפשפשוק!</b>`,
      '',
      '🛍️ פלטפורמת היד-שנייה המהירה בטלגרם.',
      '',
      '➕ פרסם מודעה בחינם בתוך דקה',
      '🔍 חפש וסנן מוצרים לפי קטגוריה, אזור ומחיר',
      '⭐️ שמור מודעות למועדפים וקבל פרטי מוכר בלחיצה',
      '',
      'בחר פעולה מהתפריט למטה 👇',
    ].join('\n'),
    { parse_mode: 'HTML', ...kb.mainMenu() }
  );
}

async function showSupport(ctx) {
  return ctx.reply(
    [
      '📞 <b>תמיכה ויצירת קשר</b>',
      '',
      'נתקלת בבעיה? יש לך שאלה או הצעה לשיפור?',
      env.SUPPORT_USERNAME ? `💬 צוות התמיכה: @${fmt.esc(env.SUPPORT_USERNAME)}` : null,
      '',
      '📜 <b>כללי פרסום:</b>',
      '• אסור לפרסם מוצרים מזויפים, נשק, סמים או תכנים בוגרים.',
      '• יש לצרף תמונות אמיתיות של המוצר עצמו.',
      '• מודעה שאינה עומדת בכללים תידחה על ידי המנהלים.',
      '',
      '⚠️ הבוט מהווה לוח מודעות בלבד ואינו צד בעסקה.',
    ]
      .filter((line) => line !== null && line !== undefined)
      .join('\n'),
    { parse_mode: 'HTML', ...kb.supportKeyboard() }
  );
}

async function showChannel(ctx) {
  if (!env.CHANNEL_URL) {
    return ctx.reply('📢 ערוץ המכירות עוד לא הוגדר על ידי המנהל.', kb.mainMenu());
  }
  return ctx.reply('📢 <b>ערוץ המכירות הרשמי</b>\n\nכל המודעות המאושרות מתפרסמות שם בזמן אמת 👇', {
    parse_mode: 'HTML',
    ...kb.channelLinkKeyboard(),
  });
}

/* ------------------------------ אזור אישי ------------------------------ */

async function showPersonalArea(ctx) {
  const user = ctx.state.dbUser;
  const [approved, pending, sold, rejected, favorites] = await Promise.all([
    db.countRows('listings', { user_id: user.id, status: 'approved' }),
    db.countRows('listings', { user_id: user.id, status: 'pending' }),
    db.countRows('listings', { user_id: user.id, status: 'sold' }),
    db.countRows('listings', { user_id: user.id, status: 'rejected' }),
    db.countRows('favorites', { user_id: user.id }),
  ]);

  return ctx.reply(
    fmt.profileCard(user, { approved, pending, sold, rejected, favorites }),
    { parse_mode: 'HTML', ...kb.personalAreaKeyboard() }
  );
}

/* ---------------------------- המודעות שלי ---------------------------- */

async function showMyListings(ctx, page = 0) {
  const user = ctx.state.dbUser;
  const { items, total } = await db.listUserListings(user.id, page, 1);

  if (!total) {
    return ctx.reply('📭 אין לך עדיין מודעות.\n\nלחץ על «➕ פרסום מודעה חדשה» כדי להתחיל!', kb.mainMenu());
  }
  if (!items.length) return showMyListings(ctx, 0);

  const listing = items[0];
  const text = fmt.myListingCard(listing, { page, total });
  return sendCard(ctx, listing, text, kb.myListingKeyboard(listing, { page, total }));
}

/* ------------------------------ מועדפים ------------------------------ */

async function showFavorites(ctx, page = 0) {
  const user = ctx.state.dbUser;
  const { items, total } = await db.listFavorites(user.id, page, 1);

  if (!total || !items.length) {
    return ctx.reply(
      '⭐️ רשימת המועדפים שלך ריקה.\n\nבזמן חיפוש לחץ על «⭐️ שמור במועדפים» כדי לשמור מודעות.',
      kb.mainMenu()
    );
  }

  const listing = items[0];
  const text = fmt.favoriteCard(listing, { page, total });
  return sendCard(ctx, listing, text, kb.favoriteCardKeyboard(listing, { page, total }));
}

/* ------------------------------- חיפוש ------------------------------- */

function filtersSummary(filters) {
  const parts = [];
  if (filters.q) parts.push(`🔤 "${fmt.esc(filters.q)}"`);
  if (filters.categoryName) parts.push(`🗂️ ${fmt.esc(filters.categoryName)}`);
  if (filters.location) parts.push(`📍 ${fmt.esc(filters.location)}`);
  if (Number.isFinite(filters.minPrice) || Number.isFinite(filters.maxPrice)) {
    const min = Number.isFinite(filters.minPrice) ? filters.minPrice : 0;
    const max = Number.isFinite(filters.maxPrice) ? filters.maxPrice : '∞';
    parts.push(`💰 ₪${min} - ₪${max}`);
  }
  if (filters.freeOnly) parts.push('🎁 בחינם בלבד');
  return parts.length ? parts.join(' | ') : 'ללא סינון — כל המודעות';
}

async function showSearchMenu(ctx, { edit = false } = {}) {
  const filters = filtersOf(ctx);
  delete ctx.session.state;

  const text = [
    '🔍 <b>חיפוש וסינון מוצרים</b>',
    '',
    `🎯 <b>הסינון הנוכחי:</b>`,
    filtersSummary(filters),
    '',
    'בחר סינון או לחץ על «🚀 הצג תוצאות» 👇',
  ].join('\n');

  const extra = { parse_mode: 'HTML', ...kb.searchMenu(filters) };

  if (edit) {
    try {
      return await ctx.editMessageText(text, extra);
    } catch (error) {
      /* ההודעה זהה או לא ניתנת לעריכה — נשלח חדשה */
    }
  }
  return ctx.reply(text, extra);
}

async function showResult(ctx, page = 0) {
  const filters = filtersOf(ctx);
  const { items, total } = await db.searchListings(filters, page, 1);

  if (!total) {
    await ctx.reply(
      ['😕 <b>לא נמצאו מודעות התואמות לסינון.</b>', '', 'נסה לשנות את הסינון או לחפש מילה אחרת.'].join('\n'),
      { parse_mode: 'HTML' }
    );
    return showSearchMenu(ctx);
  }
  if (!items.length) return showResult(ctx, 0);

  const listing = items[0];
  await db.incrementViews(listing.id);

  const isFav = await db.isFavorite(ctx.state.dbUser.id, listing.id);
  const text = fmt.searchCard(listing, { page, total });
  return sendCard(ctx, listing, text, kb.resultCardKeyboard(listing, { page, total, isFav }));
}

/* --------------------------- יצירת קשר ודירוג --------------------------- */

async function showContact(ctx, listingId) {
  const listing = await db.getListing(listingId);
  if (!listing || ['deleted', 'rejected'].includes(listing.status)) {
    return ctx.reply('⚠️ המודעה לא נמצאה או שהוסרה.', kb.mainMenu());
  }

  await db.incrementContacts(listing.id);

  const seller = listing.seller || {};
  const buttons = [];
  if (seller.username) {
    buttons.push([{ text: `💬 פתח צ'אט עם @${seller.username}`, url: `https://t.me/${seller.username}` }]);
  }
  buttons.push(
    [1, 2, 3, 4, 5].map((stars) => ({
      text: '⭐'.repeat(stars),
      callback_data: `rate:${listing.id}:${stars}`,
    }))
  );

  await ctx.reply(
    `${fmt.contactCard(listing)}\n\n⭐ <b>לאחר העסקה — דרג את המוכר:</b>`,
    { parse_mode: 'HTML', reply_markup: { inline_keyboard: buttons }, disable_web_page_preview: true }
  );

  // התראה למוכר
  if (seller.telegram_id && String(seller.telegram_id) !== String(ctx.from.id)) {
    const buyer = ctx.from.username
      ? `@${ctx.from.username}`
      : fmt.esc([ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' '));
    try {
      await ctx.telegram.sendMessage(
        seller.telegram_id,
        [
          '🔔 <b>יש מתעניין במודעה שלך!</b>',
          '',
          `🛍️ ${fmt.esc(listing.title)}`,
          `🆔 <code>${fmt.adId(listing.id)}</code>`,
          `👤 המתעניין: ${buyer}`,
          '',
          `📊 סה"כ פניות למודעה: ${fmt.formatNumber(Number(listing.contacts_count || 0) + 1)}`,
        ].join('\n'),
        { parse_mode: 'HTML' }
      );
    } catch (error) {
      console.warn('[contact] seller notification failed:', error.message);
    }
  }
  return true;
}

/* ------------------------------ ראוטר טקסט ------------------------------ */

async function onMenuText(ctx) {
  const text = (ctx.message.text || '').trim();

  switch (text) {
    case kb.MENU.NEW:
      return createAd.start(ctx);
    case kb.MENU.SEARCH:
      return showSearchMenu(ctx);
    case kb.MENU.ME:
      return showPersonalArea(ctx);
    case kb.MENU.FAV:
      return showFavorites(ctx, 0);
    case kb.MENU.CHANNEL:
      return showChannel(ctx);
    case kb.MENU.SUPPORT:
      return showSupport(ctx);
    case kb.CANCEL:
      return ctx.reply('↩️ חזרה לתפריט הראשי.', kb.mainMenu());
    case kb.DONE_PHOTOS:
      // כפתור "סיימתי להעלות תמונות" שנשאר תקוע על המסך מתהליך פרסום קודם/שהסתיים —
      // לא מתפרש כחיפוש חופשי (שהיה גורם לשגיאה), אלא מציג את התפריט הראשי.
      return ctx.reply('ℹ️ אין כרגע פרסום מודעה פעיל. אפשר להתחיל חדש מהתפריט ➕', kb.mainMenu());
    default:
      break;
  }

  // חיפוש מהיר: כל טקסט חופשי מחפש מיד בערוץ
  if (text.length >= 2 && !text.startsWith('/')) {
    ctx.session.search = { q: text };
    await ctx.reply(`🔍 מחפש: <b>${fmt.esc(text)}</b>...`, { parse_mode: 'HTML' });
    return showResult(ctx, 0);
  }

  return ctx.reply('🤖 לא הבנתי. בחר פעולה מהתפריט 👇', kb.mainMenu());
}

/** טקסט שנכתב בתוך זרימת החיפוש (חיפוש חופשי / טווח מחירים) או עדכון טלפון. */
async function onSearchText(ctx) {
  const text = (ctx.message.text || '').trim();
  const state = ctx.session.state || '';
  const filters = filtersOf(ctx);

  if (text === kb.CANCEL) {
    delete ctx.session.state;
    return ctx.reply('↩️ חזרה לתפריט הראשי.', kb.mainMenu());
  }

  if (state === 'search:text') {
    filters.q = db.sanitizeSearchTerm(text);
    delete ctx.session.state;
    if (!filters.q) return ctx.reply('⚠️ מילת החיפוש לא תקינה, נסה שוב:');
    await ctx.reply(`✅ מילת חיפוש נשמרה: <b>${fmt.esc(filters.q)}</b>`, {
      parse_mode: 'HTML',
      ...kb.mainMenu(),
    });
    return showResult(ctx, 0);
  }

  if (state === 'search:price') {
    const match = text.replace(/[₪,\s]/g, '').match(/^(\d+)(?:-(\d+))?$/);
    if (!match) {
      return ctx.reply('⚠️ פורמט לא תקין. כתוב טווח כמו <code>100-500</code> או מחיר מקסימלי כמו <code>500</code>.', {
        parse_mode: 'HTML',
      });
    }
    if (match[2]) {
      filters.minPrice = Number(match[1]);
      filters.maxPrice = Number(match[2]);
    } else {
      filters.minPrice = 0;
      filters.maxPrice = Number(match[1]);
    }
    if (filters.minPrice > filters.maxPrice) {
      const swap = filters.minPrice;
      filters.minPrice = filters.maxPrice;
      filters.maxPrice = swap;
    }
    delete ctx.session.state;
    await ctx.reply(`✅ טווח מחירים: ₪${filters.minPrice} - ₪${filters.maxPrice}`, kb.mainMenu());
    return showResult(ctx, 0);
  }

  if (state === 'search:phone') {
    const digits = text.replace(/[^\d+]/g, '');
    if (digits.replace(/\D/g, '').length < 9) {
      return ctx.reply('⚠️ מספר טלפון לא תקין. נסה שוב (לדוגמה: 0501234567):');
    }
    await db.setUserPhone(ctx.state.dbUser.id, digits);
    delete ctx.session.state;
    await ctx.reply(`✅ מספר הטלפון נשמר: <code>${fmt.esc(digits)}</code>`, {
      parse_mode: 'HTML',
      ...kb.mainMenu(),
    });
    return showPersonalArea(ctx);
  }

  delete ctx.session.state;
  return onMenuText(ctx);
}

/* --------------------------------- Actions --------------------------------- */

function register(bot) {
  /* ---------- /start + deep links ---------- */
  bot.start(async (ctx) => {
    const payload = (ctx.startPayload || '').trim();

    if (payload) {
      const favMatch = payload.match(/^fav_(\d+)$/);
      const contactMatch = payload.match(/^contact_(\d+)$/);
      const adMatch = payload.match(/^ad_(\d+)$/);
      const rateMatch = payload.match(/^rate_(\d+)$/);

      if (favMatch) {
        const listingId = Number(favMatch[1]);
        const listing = await db.getListing(listingId);
        if (!listing) return ctx.reply('⚠️ המודעה לא נמצאה.', kb.mainMenu());
        await db.addFavorite(ctx.state.dbUser.id, listingId);
        await ctx.reply(
          `⭐️ <b>נשמר במועדפים!</b>\n\n🛍️ ${fmt.esc(listing.title)}\n🆔 <code>${fmt.adId(listing.id)}</code>`,
          { parse_mode: 'HTML', ...kb.mainMenu() }
        );
        return showFavorites(ctx, 0);
      }

      if (contactMatch) return showContact(ctx, Number(contactMatch[1]));

      if (adMatch) {
        const listing = await db.getListing(Number(adMatch[1]));
        if (!listing) return ctx.reply('⚠️ המודעה לא נמצאה.', kb.mainMenu());
        const isFav = await db.isFavorite(ctx.state.dbUser.id, listing.id);
        await db.incrementViews(listing.id);
        return sendCard(
          ctx,
          listing,
          fmt.searchCard(listing, { page: 0, total: 1 }),
          kb.resultCardKeyboard(listing, { page: 0, total: 1, isFav })
        );
      }

      if (rateMatch) {
        const listing = await db.getListing(Number(rateMatch[1]));
        if (!listing) return ctx.reply('⚠️ המודעה לא נמצאה.', kb.mainMenu());
        return ctx.reply(
          `⭐ <b>דרג את המוכר של המודעה:</b>\n${fmt.esc(listing.title)}`,
          { parse_mode: 'HTML', ...kb.ratingKeyboard(listing.id) }
        );
      }

      if (payload === 'publish') return createAd.start(ctx);
    }

    return showWelcome(ctx);
  });

  bot.command('menu', (ctx) => showWelcome(ctx));
  bot.command('help', (ctx) => showSupport(ctx));
  bot.command('search', (ctx) => showSearchMenu(ctx));
  bot.command('new', (ctx) => createAd.start(ctx));
  bot.command('my', (ctx) => showMyListings(ctx, 0));
  bot.command('favorites', (ctx) => showFavorites(ctx, 0));
  bot.command('cancel', async (ctx) => {
    createAd.clearWizard(ctx);
    delete ctx.session.state;
    return ctx.reply('❌ הפעולה בוטלה.', kb.mainMenu());
  });
  bot.command('id', (ctx) =>
    ctx.reply(
      [
        '🆔 <b>מזהים לצורכי הגדרה</b>',
        '',
        `👤 Your Telegram ID: <code>${ctx.from.id}</code>`,
        `💬 Chat ID: <code>${ctx.chat.id}</code>`,
        `📂 Chat type: <code>${ctx.chat.type}</code>`,
      ].join('\n'),
      { parse_mode: 'HTML' }
    )
  );

  /* ---------- תפריט ראשי (inline) ---------- */
  bot.action('m:new', async (ctx) => {
    await ctx.answerCbQuery();
    return createAd.start(ctx);
  });
  bot.action('m:me', async (ctx) => {
    await ctx.answerCbQuery();
    return showPersonalArea(ctx);
  });

  /* ---------- טלפון ---------- */
  bot.action('me:phone', async (ctx) => {
    await ctx.answerCbQuery();
    ctx.session.state = 'search:phone';
    return ctx.reply(
      '📱 שתף את מספר הטלפון שלך בלחיצה על הכפתור, או כתוב אותו כאן ידנית:',
      kb.phoneKeyboard()
    );
  });

  bot.on('contact', async (ctx) => {
    const phone = ctx.message.contact && ctx.message.contact.phone_number;
    if (!phone) return ctx.reply('⚠️ לא התקבל מספר טלפון.', kb.mainMenu());
    await db.setUserPhone(ctx.state.dbUser.id, phone);
    delete ctx.session.state;
    await ctx.reply(`✅ מספר הטלפון נשמר: <code>${fmt.esc(phone)}</code>`, {
      parse_mode: 'HTML',
      ...kb.mainMenu(),
    });
    return showPersonalArea(ctx);
  });

  /* ---------- חיפוש ---------- */
  bot.action('s:menu', async (ctx) => {
    await ctx.answerCbQuery();
    return showSearchMenu(ctx);
  });

  bot.action('s:text', async (ctx) => {
    await ctx.answerCbQuery();
    ctx.session.state = 'search:text';
    return ctx.reply('🔤 כתוב מה לחפש (שם מוצר או מילה מהתיאור):', kb.cancelOnly());
  });

  bot.action('s:cat', async (ctx) => {
    await ctx.answerCbQuery();
    const categories = await db.listCategories();
    return ctx.reply('🗂️ בחר קטגוריה לסינון:', {
      ...kb.categoriesGrid(categories, 'sc:', [
        [{ text: '📦 כל הקטגוריות', callback_data: 'sc:0' }],
      ]),
    });
  });

  bot.action(/^sc:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const filters = filtersOf(ctx);
    const id = Number(ctx.match[1]);
    if (!id) {
      delete filters.categoryId;
      delete filters.categoryName;
    } else {
      const category = await db.getCategory(id);
      filters.categoryId = id;
      filters.categoryName = category ? `${category.name_he} ${category.emoji}` : '';
    }
    await safeDelete(ctx);
    return showSearchMenu(ctx);
  });

  bot.action('s:loc', async (ctx) => {
    await ctx.answerCbQuery();
    return ctx.reply('📍 בחר אזור לסינון:', {
      ...kb.regionsKeyboard('sl:', [[{ text: '🌍 כל הארץ', callback_data: 'sl:all' }]]),
    });
  });

  bot.action(/^sl:(all|\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const filters = filtersOf(ctx);
    if (ctx.match[1] === 'all') delete filters.location;
    else filters.location = kb.REGIONS[Number(ctx.match[1])];
    await safeDelete(ctx);
    return showSearchMenu(ctx);
  });

  bot.action('s:price', async (ctx) => {
    await ctx.answerCbQuery();
    ctx.session.state = 'search:price';
    return ctx.reply(
      '💰 כתוב טווח מחירים בשקלים.\n\nלדוגמה: <code>100-500</code>\nאו מחיר מקסימלי: <code>500</code>',
      { parse_mode: 'HTML', ...kb.cancelOnly() }
    );
  });

  bot.action('s:free', async (ctx) => {
    const filters = filtersOf(ctx);
    filters.freeOnly = !filters.freeOnly;
    await ctx.answerCbQuery(filters.freeOnly ? 'מציג רק מודעות בחינם' : 'הסינון בוטל');
    return showSearchMenu(ctx, { edit: true });
  });

  bot.action('s:reset', async (ctx) => {
    await ctx.answerCbQuery('הסינונים אופסו');
    ctx.session.search = {};
    return showSearchMenu(ctx, { edit: true });
  });

  bot.action('s:run', async (ctx) => {
    await ctx.answerCbQuery('מחפש...');
    return showResult(ctx, 0);
  });

  bot.action(/^res:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    await safeDelete(ctx);
    return showResult(ctx, Number(ctx.match[1]));
  });

  /* ---------- מועדפים ---------- */
  bot.action(/^fav:add:(\d+)$/, async (ctx) => {
    await db.addFavorite(ctx.state.dbUser.id, Number(ctx.match[1]));
    await ctx.answerCbQuery('⭐️ נשמר במועדפים!');
    try {
      const markup = ctx.callbackQuery.message.reply_markup;
      markup.inline_keyboard[0] = [
        { text: '💔 הסר מהמועדפים', callback_data: `fav:del:${ctx.match[1]}` },
      ];
      await ctx.editMessageReplyMarkup(markup);
    } catch (error) {
      /* noop */
    }
    return true;
  });

  bot.action(/^fav:del:(\d+)$/, async (ctx) => {
    await db.removeFavorite(ctx.state.dbUser.id, Number(ctx.match[1]));
    await ctx.answerCbQuery('💔 הוסר מהמועדפים');
    try {
      const markup = ctx.callbackQuery.message.reply_markup;
      markup.inline_keyboard[0] = [
        { text: '⭐️ שמור במועדפים', callback_data: `fav:add:${ctx.match[1]}` },
      ];
      await ctx.editMessageReplyMarkup(markup);
    } catch (error) {
      /* noop */
    }
    return true;
  });

  bot.action(/^fav:rm:(\d+):(\d+)$/, async (ctx) => {
    await db.removeFavorite(ctx.state.dbUser.id, Number(ctx.match[1]));
    await ctx.answerCbQuery('💔 הוסר מהמועדפים');
    await safeDelete(ctx);
    return showFavorites(ctx, Number(ctx.match[2]));
  });

  bot.action(/^fv:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    await safeDelete(ctx);
    return showFavorites(ctx, Number(ctx.match[1]));
  });

  /* ---------- יצירת קשר ---------- */
  bot.action(/^ct:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    return showContact(ctx, Number(ctx.match[1]));
  });

  /* ---------- דירוג ---------- */
  bot.action(/^rate:(\d+):([1-5])$/, async (ctx) => {
    const listingId = Number(ctx.match[1]);
    const stars = Number(ctx.match[2]);
    const listing = await db.getListing(listingId);

    if (!listing) return ctx.answerCbQuery('⚠️ המודעה לא נמצאה', { show_alert: true });
    if (listing.user_id === ctx.state.dbUser.id) {
      return ctx.answerCbQuery('⚠️ לא ניתן לדרג את עצמך', { show_alert: true });
    }

    const saved = await db.addRating({
      listingId,
      sellerId: listing.user_id,
      raterId: ctx.state.dbUser.id,
      stars,
    });

    if (!saved) return ctx.answerCbQuery('ℹ️ כבר דירגת את המודעה הזו', { show_alert: true });

    await ctx.answerCbQuery(`תודה! דירגת ${stars} כוכבים ⭐`);
    return ctx.reply(`✅ הדירוג שלך (${'⭐'.repeat(stars)}) נשמר. תודה על העזרה לקהילה!`);
  });

  /* ---------- המודעות שלי ---------- */
  bot.action(/^my:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    await safeDelete(ctx);
    return showMyListings(ctx, Number(ctx.match[1]));
  });

  bot.action(/^my:sold:(\d+)$/, async (ctx) => {
    const listing = await db.getListing(Number(ctx.match[1]));
    if (!listing || listing.user_id !== ctx.state.dbUser.id) {
      return ctx.answerCbQuery('⚠️ המודעה לא שלך', { show_alert: true });
    }
    if (listing.status === 'sold') return ctx.answerCbQuery('ℹ️ המודעה כבר מסומנת כנמכרה');

    const updated = await db.updateListing(listing.id, {
      status: 'sold',
      sold_at: new Date().toISOString(),
    });
    await publish.markSoldInChannel(ctx.telegram, updated);

    await ctx.answerCbQuery('🏷️ סומן כנמכר!');
    await ctx.reply(
      [
        '🏷️ <b>המודעה סומנה כנמכרה!</b>',
        '',
        `🛍️ ${fmt.esc(listing.title)}`,
        '📢 הפוסט בערוץ עודכן עם תג "נמכר".',
        '',
        'מזל טוב על המכירה! 🎉',
      ].join('\n'),
      { parse_mode: 'HTML' }
    );
    await safeDelete(ctx);
    return showMyListings(ctx, 0);
  });

  bot.action(/^my:bump:(\d+)$/, async (ctx) => {
    const listing = await db.getListing(Number(ctx.match[1]));
    if (!listing || listing.user_id !== ctx.state.dbUser.id) {
      return ctx.answerCbQuery('⚠️ המודעה לא שלך', { show_alert: true });
    }
    if (listing.status !== 'approved') {
      return ctx.answerCbQuery('⚠️ ניתן להקפיץ רק מודעה מפורסמת', { show_alert: true });
    }

    const lastBump = listing.bumped_at ? new Date(listing.bumped_at).getTime() : 0;
    const elapsedHours = (Date.now() - lastBump) / 3600000;
    if (lastBump && elapsedHours < env.BUMP_COOLDOWN_HOURS) {
      const remaining = Math.ceil(env.BUMP_COOLDOWN_HOURS - elapsedHours);
      return ctx.answerCbQuery(`⏳ ניתן להקפיץ שוב בעוד ${remaining} שעות`, { show_alert: true });
    }

    await ctx.answerCbQuery('🔄 מקפיץ...');
    try {
      await publish.bumpListing(ctx.telegram, listing.id);
      await ctx.reply('🔄 <b>המודעה הוקפצה לראש הערוץ!</b> 🚀', { parse_mode: 'HTML' });
    } catch (error) {
      console.error('[bump] failed:', error.message);
      await ctx.reply('⚠️ ההקפצה נכשלה. נסה שוב מאוחר יותר.');
    }
    await safeDelete(ctx);
    return showMyListings(ctx, 0);
  });

  bot.action(/^my:del:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const listing = await db.getListing(Number(ctx.match[1]));
    if (!listing || listing.user_id !== ctx.state.dbUser.id) {
      return ctx.reply('⚠️ המודעה לא נמצאה.');
    }
    return ctx.reply(
      `🗑️ <b>למחוק את המודעה?</b>\n\n${fmt.esc(listing.title)}\n\nהפעולה תסיר את הפוסט גם מהערוץ ואינה ניתנת לשחזור.`,
      { parse_mode: 'HTML', ...kb.confirmDeleteKeyboard(listing.id) }
    );
  });

  bot.action(/^my:deldo:(\d+)$/, async (ctx) => {
    const listing = await db.getListing(Number(ctx.match[1]));
    if (!listing || listing.user_id !== ctx.state.dbUser.id) {
      return ctx.answerCbQuery('⚠️ המודעה לא שלך', { show_alert: true });
    }

    await publish.removeFromChannel(ctx.telegram, listing);
    await db.updateListing(listing.id, {
      status: 'deleted',
      channel_message_id: null,
      channel_media_message_ids: [],
    });

    await ctx.answerCbQuery('🗑️ נמחק');
    await safeDelete(ctx);
    await ctx.reply('🗑️ <b>המודעה נמחקה</b> והוסרה מהערוץ.', { parse_mode: 'HTML' });
    return showMyListings(ctx, 0);
  });
}

module.exports = {
  register,
  onMenuText,
  onSearchText,
  showWelcome,
  showSearchMenu,
  showResult,
  showMyListings,
  showFavorites,
  showPersonalArea,
  showContact,
};
