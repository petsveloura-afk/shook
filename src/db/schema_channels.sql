-- ============================================================================
--  Pashpashuk — ניהול ערוצים וקבוצות (Schema — bot_destinations)
--  מיגרציה תוספתית בלבד: לא מוחקת ולא משנה אף טבלה או עמודה קיימת.
--  הרצה: Supabase -> SQL Editor -> Run  (בטוח להרצה חוזרת)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. BOT_DESTINATIONS — הערוצים/הקבוצות שהבוט מחובר אליהם, לפי תפקיד
--    role = 'channel'      -> ערוץ פרסום מודעות מאושרות
--    role = 'admin_group'  -> קבוצה שמקבלת בקשות אישור מנהל
-- ----------------------------------------------------------------------------
create table if not exists public.bot_destinations (
  id         bigserial primary key,
  chat_id    bigint not null,
  chat_title text,
  chat_type  text,
  role       text not null check (role in ('channel', 'admin_group')),
  added_by   bigint,
  created_at timestamptz not null default now(),
  unique (chat_id, role)
);

create index if not exists bot_destinations_role_idx on public.bot_destinations (role);

alter table public.bot_destinations enable row level security;

-- ----------------------------------------------------------------------------
-- 2. הרחבת LISTINGS — מעקב פרסום במספר ערוצים במקביל
--    (השדות channel_message_id / channel_media_message_ids הישנים ממשיכים
--    להצביע על הערוץ הראשי לצורך תאימות מלאה אחורה)
-- ----------------------------------------------------------------------------
alter table public.listings add column if not exists channel_posts jsonb not null default '[]'::jsonb;

-- ============================================================================
--  אימות מהיר:
--    select * from public.bot_destinations;
-- ============================================================================
