'use strict';

/**
 * נקודת הכניסה לריצה מתמדת 24/7 (Hugging Face Spaces / Railway / מקומי).
 *
 * MODE=polling  -> Long Polling (ברירת מחדל, לא דורש דומיין)
 * MODE=webhook  -> Express שמאזין ל-Webhook (למי שכן יש דומיין ציבורי)
 *
 * שרת ה-HTTP נדרש ב-Hugging Face Spaces (בדיקת פורט חי) ומשמש גם כ-Health Check
 * עבור שירותי keepalive כמו cron-job.org.
 */

const express = require('express');
const env = require('./config/env');
const { getBot, registerCommands } = require('./bot');

const bot = getBot();
const app = express();

app.use(express.json({ limit: '2mb' }));

app.get('/', (_req, res) => {
  res.status(200).json({
    ok: true,
    service: 'pashpashuk-marketplace-bot',
    mode: env.MODE,
    uptime_seconds: Math.round(process.uptime()),
    time: new Date().toISOString(),
  });
});

app.get('/health', (_req, res) => res.status(200).send('OK'));

async function main() {
  const me = await bot.telegram.getMe();
  bot.botInfo = me;
  if (!env.BOT_USERNAME) env.BOT_USERNAME = me.username;
  await registerCommands(bot);

  if (env.MODE === 'webhook') {
    const url = env.webhookUrl();
    if (!url) throw new Error('MODE=webhook requires PUBLIC_URL to be configured');

    app.use(bot.webhookCallback(env.WEBHOOK_PATH, { secretToken: env.WEBHOOK_SECRET || undefined }));
    await bot.telegram.setWebhook(url, {
      secret_token: env.WEBHOOK_SECRET || undefined,
      allowed_updates: ['message', 'callback_query', 'my_chat_member'],
    });
    console.log(`[server] webhook mode. listening on ${url}`);
  } else {
    await bot.telegram.deleteWebhook({ drop_pending_updates: false });
    bot.launch({ dropPendingUpdates: false });
    console.log('[server] long polling started');
  }

  app.listen(env.PORT, '0.0.0.0', () => {
    console.log(`[server] @${me.username} is live | HTTP port ${env.PORT} | mode: ${env.MODE}`);
  });
}

function shutdown(signal) {
  console.log(`[server] received ${signal}, shutting down...`);
  try {
    bot.stop(signal);
  } catch (error) {
    /* noop */
  }
  process.exit(0);
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

process.on('unhandledRejection', (reason) => {
  console.error('[server] unhandledRejection:', reason);
});

main().catch((error) => {
  console.error('[server] fatal startup error:', error);
  process.exit(1);
});
