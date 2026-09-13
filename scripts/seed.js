#!/usr/bin/env node
'use strict';

/**
 * בדיקת חיבור ל-Supabase + זריעת קטגוריות ברירת מחדל (אם הטבלה ריקה).
 * שימוש: npm run seed
 */

const db = require('../src/db/supabase');

const DEFAULT_CATEGORIES = [
  { name_he: 'רכב ואופנועים', emoji: '🚗', slug: 'vehicles', sort_order: 10 },
  { name_he: 'נדל"ן ודירות', emoji: '🏠', slug: 'realestate', sort_order: 20 },
  { name_he: 'ריהוט לבית', emoji: '🛋️', slug: 'furniture', sort_order: 30 },
  { name_he: 'סלולרי ומחשבים', emoji: '📱', slug: 'electronics', sort_order: 40 },
  { name_he: 'מוצרי חשמל', emoji: '🔌', slug: 'appliances', sort_order: 50 },
  { name_he: 'אופנה וטיפוח', emoji: '👕', slug: 'fashion', sort_order: 60 },
  { name_he: 'לתינוק ולילד', emoji: '🧸', slug: 'kids', sort_order: 70 },
  { name_he: 'ספורט ופנאי', emoji: '⚽', slug: 'sport', sort_order: 80 },
  { name_he: 'חיות מחמד', emoji: '🐾', slug: 'pets', sort_order: 90 },
  { name_he: 'כלי עבודה וגינון', emoji: '🛠️', slug: 'tools', sort_order: 100 },
  { name_he: 'דרושים ועבודה', emoji: '💼', slug: 'jobs', sort_order: 110 },
  { name_he: 'שונות', emoji: '✨', slug: 'misc', sort_order: 120 },
];

async function main() {
  const existing = await db.listCategories();
  console.log(`✅ Supabase connection OK. Existing categories: ${existing.length}`);

  const existingSlugs = new Set(existing.map((category) => category.slug));
  let added = 0;

  for (const category of DEFAULT_CATEGORIES) {
    if (existingSlugs.has(category.slug)) continue;
    await db.addCategory(category);
    added += 1;
    console.log(`   + ${category.emoji} ${category.name_he}`);
  }

  const metrics = await db.getMetrics();
  console.log(`\n🌱 Added ${added} categories.`);
  console.log('📊 Metrics:', JSON.stringify(metrics, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Seed failed:', error.message);
    console.error('   ודא שהרצת את src/db/schema.sql ב-Supabase ושה-SUPABASE_SERVICE_ROLE_KEY נכון.');
    process.exit(1);
  });
