#!/usr/bin/env node
'use strict';

/**
 * ניהול ה-Webhook מהטרמינל:
 *   npm run set-webhook      (דורש PUBLIC_URL ב-.env)
 *   npm run webhook-info
 *   npm run delete-webhook
 */

const { Telegraf } = require('telegraf');
const env = require('../src/config/env');
const { COMMANDS } = require('../src/bot');

const bot = new Telegraf(env.BOT_TOKEN);
const action = (process.argv[2] || 'info').toLowerCase();

async function main() {
  const me = await bot.telegram.getMe();
  console.log(`Bot: @${me.username} (${me.id})`);

  if (action === 'set') {
    const url = env.webhookUrl();
    if (!url) throw new Error('PUBLIC_URL is not configured in .env');

    await bot.telegram.setWebhook(url, {
      secret_token: env.WEBHOOK_SECRET || undefined,
      allowed_updates: ['message', 'callback_query', 'my_chat_member'],
      drop_pending_updates: true,
    });
    await bot.telegram.setMyCommands(COMMANDS);
    console.log(`✅ Webhook set to: ${url}`);
  } else if (action === 'delete') {
    await bot.telegram.deleteWebhook({ drop_pending_updates: false });
    console.log('🗑️ Webhook deleted (polling mode is now possible)');
  }

  const info = await bot.telegram.getWebhookInfo();
  console.log('ℹ️ Webhook info:', JSON.stringify(info, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Failed:', error.message);
    process.exit(1);
  });
