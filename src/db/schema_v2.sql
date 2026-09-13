-- ============================================================================
--  Pashpashuk — PRO UPGRADE (Schema v2)
--  מיגרציה תוספתית בלבד: לא מוחקת ולא משנה אף טבלה או עמודה קיימת.
--  הרצה: Supabase -> SQL Editor -> Run  (אחרי schema.sql, בטוח להרצה חוזרת)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. הרחבת USERS — שפה, העדפות, תגי מוכר
-- ----------------------------------------------------------------------------
alter table public.users add column if not exists language              text    not null default 'he';
alter table public.users add column if not exists notifications_enabled boolean not null default true;
alter table public.users add column if not exists show_phone            boolean not null default false;
alter table public.users add column if not exists is_verified           boolean not null default false;
alter table public.users add column if not exists is_vip                boolean not null default false;
alter table public.users add column if not exists ads_posted_count      integer not null default 0;
alter table public.users add column if not exists deals_count           integer not null default 0;
alter table public.users add column if not exists last_ad_at            timestamptz;
alter table public.users add column if not exists home_region           text;
alter table public.users add column if not exists notes                 text;

create index if not exists users_language_idx  on public.users (language);
create index if not exists users_lastseen_idx  on public.users (last_seen_at desc);

-- ----------------------------------------------------------------------------
-- 2. הרחבת LISTINGS — קידום, דיווחים, מדדים
-- ----------------------------------------------------------------------------
alter table public.listings add column if not exists is_featured    boolean not null default false;
alter table public.listings add column if not exists featured_until timestamptz;
alter table public.listings add column if not exists report_count   integer not null default 0;
alter table public.listings add column if not exists bump_count     integer not null default 0;
alter table public.listings add column if not exists share_count    integer not null default 0;
alter table public.listings add column if not exists currency       text    not null default 'ILS';
alter table public.listings add column if not exists city           text;
alter table public.listings add column if not exists expires_at     timestamptz;

create index if not exists listings_featured_idx on public.listings (is_featured, status);
create index if not exists listings_reports_idx  on public.listings (report_count desc);
create index if not exists listings_views_idx    on public.listings (views_count desc);

-- ----------------------------------------------------------------------------
-- 3. SAVED SEARCHES — התראות חכמות על מודעות חדשות
-- ----------------------------------------------------------------------------
create table if not exists public.saved_searches (
  id          bigserial primary key,
  user_id     bigint not null references public.users (id) on delete cascade,
  title       text   not null default '',
  q           text,
  category_id bigint references public.categories (id) on delete set null,
  location    text,
  min_price   numeric(12, 2),
  max_price   numeric(12, 2),
  free_only   boolean not null default false,
  is_active   boolean not null default true,
  hits_count  integer not null default 0,
  last_hit_at timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists saved_searches_user_idx   on public.saved_searches (user_id, is_active);
create index if not exists saved_searches_active_idx on public.saved_searches (is_active);

-- ----------------------------------------------------------------------------
-- 4. REPORTS — דיווחי משתמשים על מודעות
-- ----------------------------------------------------------------------------
create table if not exists public.reports (
  id           bigserial primary key,
  listing_id   bigint not null references public.listings (id) on delete cascade,
  reporter_id  bigint not null references public.users (id)    on delete cascade,
  reason       text   not null,
  note         text,
  status       text   not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  handled_by   bigint,
  handled_at   timestamptz,
  created_at   timestamptz not null default now(),
  unique (listing_id, reporter_id)
);

create index if not exists reports_status_idx  on public.reports (status, created_at desc);
create index if not exists reports_listing_idx on public.reports (listing_id);

-- ----------------------------------------------------------------------------
-- 5. ADMIN AUDIT LOG — תיעוד כל פעולת ניהול
-- ----------------------------------------------------------------------------
create table if not exists public.admin_audit (
  id           bigserial primary key,
  admin_id     bigint not null,
  admin_name   text,
  action       text   not null,
  target_type  text,
  target_id    text,
  details      jsonb  not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

create index if not exists admin_audit_time_idx  on public.admin_audit (created_at desc);
create index if not exists admin_audit_admin_idx on public.admin_audit (admin_id, created_at desc);

-- ----------------------------------------------------------------------------
-- 6. BLOCKED WORDS — סינון תוכן אוטומטי
-- ----------------------------------------------------------------------------
create table if not exists public.blocked_words (
  id         bigserial primary key,
  word       text not null unique,
  severity   text not null default 'block' check (severity in ('block', 'flag')),
  created_by bigint,
  created_at timestamptz not null default now()
);

insert into public.blocked_words (word, severity) values
  ('הלוואה בריבית', 'flag'),
  ('כרטיס אשראי גנוב', 'block'),
  ('סמים', 'block'),
  ('אקדח', 'block'),
  ('רובה', 'block'),
  ('תחמושת', 'block'),
  ('מסמכים מזויפים', 'block'),
  ('דרכון מזויף', 'block'),
  ('escort', 'block'),
  ('casino', 'flag')
on conflict (word) do nothing;

-- ----------------------------------------------------------------------------
-- 7. APP SETTINGS — הגדרות מערכת שניתנות לשינוי מהבוט (Key/Value)
-- ----------------------------------------------------------------------------
create table if not exists public.app_settings (
  key        text primary key,
  value      jsonb not null,
  updated_by bigint,
  updated_at timestamptz not null default now()
);

insert into public.app_settings (key, value) values
  ('auto_approve',      'false'::jsonb),
  ('maintenance_mode',  'false'::jsonb),
  ('max_ads_per_day',   '5'::jsonb),
  ('max_alerts',        '10'::jsonb),
  ('require_photo',     'true'::jsonb),
  ('listing_ttl_days',  '60'::jsonb),
  ('welcome_bonus',     'true'::jsonb)
on conflict (key) do nothing;

-- ----------------------------------------------------------------------------
-- 8. EVENTS — טלמטריה קלה לאנליטיקס (ללא מידע אישי מזהה)
-- ----------------------------------------------------------------------------
create table if not exists public.events (
  id         bigserial primary key,
  user_id    bigint,
  type       text not null,
  payload    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists events_type_time_idx on public.events (type, created_at desc);
create index if not exists events_time_idx      on public.events (created_at desc);

-- ----------------------------------------------------------------------------
-- 9. RLS לטבלאות החדשות
-- ----------------------------------------------------------------------------
alter table public.saved_searches enable row level security;
alter table public.reports        enable row level security;
alter table public.admin_audit    enable row level security;
alter table public.blocked_words  enable row level security;
alter table public.app_settings   enable row level security;
alter table public.events         enable row level security;

-- ----------------------------------------------------------------------------
-- 10. VIEWS לאנליטיקס
-- ----------------------------------------------------------------------------
create or replace view public.v_category_stats as
select
  c.id,
  c.name_he,
  c.emoji,
  count(l.id) filter (where l.status = 'approved') as active_listings,
  count(l.id) filter (where l.status = 'sold')     as sold_listings,
  coalesce(sum(l.views_count), 0)                  as total_views,
  coalesce(round(avg(nullif(l.price, 0)), 0), 0)   as avg_price
from public.categories c
left join public.listings l on l.category_id = c.id
group by c.id, c.name_he, c.emoji;

create or replace view public.v_top_sellers as
select
  u.id,
  u.telegram_id,
  u.full_name,
  u.username,
  u.rating_sum,
  u.rating_count,
  count(l.id) filter (where l.status = 'approved') as active_listings,
  count(l.id) filter (where l.status = 'sold')     as sold_listings,
  coalesce(sum(l.views_count), 0)                  as total_views
from public.users u
join public.listings l on l.user_id = u.id
where u.status = 'active'
group by u.id, u.telegram_id, u.full_name, u.username, u.rating_sum, u.rating_count;

-- ============================================================================
--  אימות מהיר:
--    select key, value from public.app_settings;
--    select * from public.v_category_stats order by active_listings desc;
-- ============================================================================
