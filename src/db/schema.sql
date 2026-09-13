-- ============================================================================
--  Pashpashuk Marketplace Bot — Supabase / PostgreSQL Schema
--  הרצה: Supabase Dashboard -> SQL Editor -> New query -> Paste -> Run
--  הסקריפט בטוח להרצה חוזרת (idempotent).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. USERS
-- ----------------------------------------------------------------------------
create table if not exists public.users (
  id             bigserial primary key,
  telegram_id    bigint      not null unique,
  full_name      text        not null default '',
  username       text,
  phone_number   text,
  rating_sum     integer     not null default 0,
  rating_count   integer     not null default 0,
  status         text        not null default 'active' check (status in ('active', 'banned')),
  ban_reason     text,
  last_seen_at   timestamptz not null default now(),
  created_at     timestamptz not null default now()
);

create index if not exists users_telegram_id_idx on public.users (telegram_id);
create index if not exists users_status_idx       on public.users (status);

-- ----------------------------------------------------------------------------
-- 2. CATEGORIES
-- ----------------------------------------------------------------------------
create table if not exists public.categories (
  id         bigserial primary key,
  name_he    text not null,
  emoji      text not null default '📦',
  slug       text not null unique,
  sort_order integer not null default 100,
  created_at timestamptz not null default now()
);

create index if not exists categories_sort_idx on public.categories (sort_order, id);

-- ----------------------------------------------------------------------------
-- 3. LISTINGS
-- ----------------------------------------------------------------------------
create table if not exists public.listings (
  id                        bigserial primary key,
  user_id                   bigint not null references public.users (id) on delete cascade,
  title                     text   not null,
  description               text   not null,
  category_id               bigint references public.categories (id) on delete set null,
  condition                 text   not null default 'good'
                              check (condition in ('new_sealed', 'like_new', 'good', 'parts')),
  price                     numeric(12, 2) not null default 0,
  price_type                text   not null default 'fixed'
                              check (price_type in ('fixed', 'flexible', 'free')),
  location                  text   not null default '',
  photos                    text[] not null default '{}',
  status                    text   not null default 'pending'
                              check (status in ('pending', 'approved', 'rejected', 'sold', 'deleted')),
  reject_reason             text,
  channel_message_id        bigint,
  channel_media_message_ids bigint[] not null default '{}',
  views_count               integer not null default 0,
  contacts_count            integer not null default 0,
  bumped_at                 timestamptz,
  approved_at               timestamptz,
  sold_at                   timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

create index if not exists listings_status_idx     on public.listings (status);
create index if not exists listings_user_idx       on public.listings (user_id, status);
create index if not exists listings_category_idx   on public.listings (category_id, status);
create index if not exists listings_location_idx   on public.listings (location, status);
create index if not exists listings_feed_idx       on public.listings (status, bumped_at desc, created_at desc);
create index if not exists listings_price_idx      on public.listings (price);

-- עדכון אוטומטי של updated_at
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists listings_touch_updated_at on public.listings;
create trigger listings_touch_updated_at
  before update on public.listings
  for each row execute function public.touch_updated_at();

-- ----------------------------------------------------------------------------
-- 4. FAVORITES
-- ----------------------------------------------------------------------------
create table if not exists public.favorites (
  user_id    bigint not null references public.users (id)    on delete cascade,
  listing_id bigint not null references public.listings (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, listing_id)
);

create index if not exists favorites_user_idx on public.favorites (user_id, created_at desc);

-- ----------------------------------------------------------------------------
-- 5. RATINGS (דירוג מוכרים — מזין את rating_sum / rating_count ב-users)
-- ----------------------------------------------------------------------------
create table if not exists public.ratings (
  id         bigserial primary key,
  listing_id bigint not null references public.listings (id) on delete cascade,
  seller_id  bigint not null references public.users (id)    on delete cascade,
  rater_id   bigint not null references public.users (id)    on delete cascade,
  stars      smallint not null check (stars between 1 and 5),
  created_at timestamptz not null default now(),
  unique (listing_id, rater_id)
);

create index if not exists ratings_seller_idx on public.ratings (seller_id);

-- ----------------------------------------------------------------------------
-- 6. SESSIONS (FSM state — חיוני ל-Vercel Serverless שהוא Stateless)
-- ----------------------------------------------------------------------------
create table if not exists public.sessions (
  key        text primary key,
  value      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 7. BROADCASTS (לוג שידורים של האדמין)
-- ----------------------------------------------------------------------------
create table if not exists public.broadcasts (
  id          bigserial primary key,
  admin_id    bigint,
  message     text not null,
  sent_count  integer not null default 0,
  failed_count integer not null default 0,
  created_at  timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 8. RLS — חוסמים גישה אנונימית. ה-service_role עובד תמיד (bypass RLS).
-- ----------------------------------------------------------------------------
alter table public.users      enable row level security;
alter table public.categories enable row level security;
alter table public.listings   enable row level security;
alter table public.favorites  enable row level security;
alter table public.ratings    enable row level security;
alter table public.sessions   enable row level security;
alter table public.broadcasts enable row level security;

-- ----------------------------------------------------------------------------
-- 9. SEED — קטגוריות ברירת מחדל
-- ----------------------------------------------------------------------------
insert into public.categories (name_he, emoji, slug, sort_order) values
  ('רכב ואופנועים',    '🚗', 'vehicles',    10),
  ('נדל"ן ודירות',      '🏠', 'realestate',  20),
  ('ריהוט לבית',        '🛋️', 'furniture',   30),
  ('סלולרי ומחשבים',    '📱', 'electronics', 40),
  ('מוצרי חשמל',        '🔌', 'appliances',  50),
  ('אופנה וטיפוח',      '👕', 'fashion',     60),
  ('לתינוק ולילד',      '🧸', 'kids',        70),
  ('ספורט ופנאי',       '⚽', 'sport',       80),
  ('חיות מחמד',         '🐾', 'pets',        90),
  ('כלי עבודה וגינון',  '🛠️', 'tools',      100),
  ('דרושים ועבודה',     '💼', 'jobs',       110),
  ('שונות',             '✨', 'misc',       120)
on conflict (slug) do nothing;

-- ============================================================================
--  סיום. אימות מהיר:
--    select count(*) from public.categories;   -- צפוי: 12
-- ============================================================================
