-- FamilyQuest · 0001 — базовая схема
-- Порядок применения: 0001 → 0002 → 0003 → 0004 → 0005.
-- Все файлы можно применять повторно (idempotent).

create extension if not exists pgcrypto;

-- ─────────────────────────────── семьи и участники ───────────────────────────

create table if not exists public.families (
  id          uuid primary key default gen_random_uuid(),
  name        text not null default 'Наша семья',
  timezone    text not null default 'Europe/Moscow',
  coin_name   text not null default 'монеты',
  xp_name     text not null default 'опыт',
  settings    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create table if not exists public.members (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references public.families(id) on delete cascade,
  user_id     uuid unique references auth.users(id) on delete set null,
  login       text not null unique,
  role        text not null default 'child' check (role in ('admin', 'child')),
  display_name text not null,
  emoji       text not null default '🙂',
  color       text not null default '#6aa8ff',
  avatar_url  text,
  birth_date  date,
  xp_total    integer not null default 0 check (xp_total >= 0),
  coins       integer not null default 0 check (coins >= 0),
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create index if not exists members_family_idx on public.members (family_id) where deleted_at is null;

-- Миграция для уже установленных баз
alter table public.members add column if not exists avatar_url text;

-- ─────────────────────────────── задачи ─────────────────────────────────────

create table if not exists public.task_templates (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references public.families(id) on delete cascade,
  assignee_id uuid references public.members(id) on delete cascade,
  title       text not null,
  description text,
  category    text not null default 'дом',
  kind        text not null default 'quest' check (kind in ('duty', 'quest')),
  base_weight integer not null default 10 check (base_weight between 0 and 1000),
  recurrence  text not null default 'none' check (recurrence in ('none', 'daily', 'weekly', 'monthly')),
  weekdays    smallint[],
  due_time    time,
  approval    text not null default 'auto' check (approval in ('auto', 'review')),
  active      boolean not null default true,
  created_by  uuid references public.members(id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists templates_family_idx on public.task_templates (family_id) where active;

create table if not exists public.assignments (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references public.families(id) on delete cascade,
  template_id uuid references public.task_templates(id) on delete set null,
  title       text not null,
  category    text not null default 'дом',
  -- assignee_id = NULL означает «лежит в общей очереди»: возьмёт тот, кто первый.
  assignee_id uuid references public.members(id) on delete cascade,
  created_by  uuid references public.members(id) on delete set null,
  kind        text not null default 'quest' check (kind in ('duty', 'quest')),
  weight      integer not null default 10 check (weight >= 0),
  approval    text not null default 'auto' check (approval in ('auto', 'review')),
  due_date    date,
  due_at      timestamptz,
  status      text not null default 'pending'
              check (status in ('pending', 'submitted', 'approved', 'rejected', 'missed', 'skipped')),
  source      text not null default 'template' check (source in ('template', 'manual', 'exchange', 'boss')),
  submitted_at timestamptz,
  decided_at   timestamptz,
  decided_by   uuid references public.members(id) on delete set null,
  coins_awarded integer not null default 0,
  xp_awarded    integer not null default 0,
  note        text,
  created_at  timestamptz not null default now()
);

-- Миграция для уже установленных баз: снимаем NOT NULL, если таблица создана раньше.
alter table public.assignments alter column assignee_id drop not null;

-- один экземпляр шаблона в день (защита от дублей при материализации) —
-- без привязки к человеку: шаблон рождает одну задачу в общую очередь
drop index if exists public.assignments_template_day_uniq;
create unique index if not exists assignments_template_day_uniq
  on public.assignments (template_id, due_date)
  where template_id is not null;

create index if not exists assignments_pool_idx
  on public.assignments (family_id, status) where assignee_id is null;

create index if not exists assignments_open_idx
  on public.assignments (family_id, due_at) where status in ('pending', 'submitted');
create index if not exists assignments_member_idx
  on public.assignments (assignee_id, status, due_date desc);

-- ─────────────────────────────── журнал баллов ───────────────────────────────

create table if not exists public.ledger (
  id          bigserial primary key,
  family_id   uuid not null references public.families(id) on delete cascade,
  member_id   uuid not null references public.members(id) on delete cascade,
  coins       integer not null default 0,
  xp          integer not null default 0,
  kind        text not null check (kind in ('award', 'penalty', 'reward', 'exchange', 'bank', 'adjust', 'bonus')),
  ref_type    text,
  ref_id      uuid,
  note        text,
  rule_version text not null default 'v1',
  idempotency_key text unique,
  created_by  uuid references public.members(id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists ledger_member_idx on public.ledger (member_id, created_at desc);
create index if not exists ledger_family_idx on public.ledger (family_id, created_at desc);

-- журнал неизменяем: исправление — только обратной транзакцией
create or replace function public.ledger_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'ledger is append-only';
end;
$$;

drop trigger if exists ledger_no_write on public.ledger;
create trigger ledger_no_write
  before update or delete on public.ledger
  for each row execute function public.ledger_immutable();

-- ─────────────────────────────── прогресс ────────────────────────────────────

create table if not exists public.levels (
  idx          integer primary key,
  name         text not null,
  xp_threshold integer not null
);

create table if not exists public.streaks (
  member_id  uuid primary key references public.members(id) on delete cascade,
  current    integer not null default 0,
  best       integer not null default 0,
  last_day   date,
  freezes    integer not null default 2,
  updated_at timestamptz not null default now()
);

create table if not exists public.achievements (
  code        text primary key,
  title       text not null,
  description text,
  hidden      boolean not null default false,
  icon        text not null default '🏅',
  rule        jsonb not null default '{}'::jsonb
);

create table if not exists public.member_achievements (
  member_id   uuid not null references public.members(id) on delete cascade,
  code        text not null references public.achievements(code) on delete cascade,
  progress    integer not null default 0,
  unlocked_at timestamptz,
  primary key (member_id, code)
);

-- ─────────────────────────────── призы ──────────────────────────────────────

create table if not exists public.rewards (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references public.families(id) on delete cascade,
  title       text not null,
  description text,
  tier        text not null default 'micro' check (tier in ('micro', 'medium', 'global')),
  price_coins integer not null default 50 check (price_coins >= 0),
  stock       integer,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists public.redemptions (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null references public.members(id) on delete cascade,
  reward_id   uuid not null references public.rewards(id) on delete cascade,
  coins_spent integer not null,
  status      text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'delivered')),
  decided_by  uuid references public.members(id) on delete set null,
  created_at  timestamptz not null default now(),
  decided_at  timestamptz
);

-- ─────────────────────────────── лента ──────────────────────────────────────

create table if not exists public.feed (
  id         bigserial primary key,
  family_id  uuid not null references public.families(id) on delete cascade,
  kind       text not null,
  actor_id   uuid references public.members(id) on delete set null,
  subject_id uuid references public.members(id) on delete set null,
  payload    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists feed_family_idx on public.feed (family_id, created_at desc);

create table if not exists public.reactions (
  feed_id   bigint not null references public.feed(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  emoji     text not null,
  created_at timestamptz not null default now(),
  primary key (feed_id, member_id, emoji)
);

-- ─────────────────────────────── приглашения и настройки ─────────────────────

create table if not exists public.invites (
  code       text primary key,
  family_id  uuid not null references public.families(id) on delete cascade,
  member_id  uuid references public.members(id) on delete cascade,
  role       text not null default 'child' check (role in ('admin', 'child')),
  expires_at timestamptz,
  used_at    timestamptz,
  used_by    uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- приватные настройки (токен Telegram и т.п.). RLS включён, политик нет:
-- доступ только через security definer функции.
create table if not exists public.app_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);
