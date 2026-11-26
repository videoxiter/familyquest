-- FamilyQuest: единый файл миграций (сгенерирован, не редактировать вручную).
-- Источник: supabase/migrations/*.sql
-- Применение: Supabase → SQL Editor → вставить целиком → Run.
-- Файл можно применять повторно.

-- ═══════════════════════════════════════════════════════════════
-- 0001_schema.sql
-- ═══════════════════════════════════════════════════════════════

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


-- ═══════════════════════════════════════════════════════════════
-- 0002_rls.sql
-- ═══════════════════════════════════════════════════════════════

-- FamilyQuest · 0002 — RLS, права, помощники доступа
-- Принцип: чтение — по своей семье; запись в домен — только через RPC
-- (security definer), чтобы нельзя было подкрутить баллы из браузера.

-- ───────────────────────────── помощники (обходят RLS) ──────────────────────

create or replace function public.current_member_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select m.id
  from public.members m
  where m.user_id = auth.uid() and m.deleted_at is null
  limit 1;
$$;

create or replace function public.current_family_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select m.family_id
  from public.members m
  where m.user_id = auth.uid() and m.deleted_at is null
  limit 1;
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.members m
    where m.user_id = auth.uid() and m.role = 'admin' and m.deleted_at is null
  );
$$;

-- ───────────────────────────── включение RLS ────────────────────────────────

alter table public.families            enable row level security;
alter table public.members             enable row level security;
alter table public.task_templates      enable row level security;
alter table public.assignments         enable row level security;
alter table public.ledger              enable row level security;
alter table public.levels              enable row level security;
alter table public.streaks             enable row level security;
alter table public.achievements        enable row level security;
alter table public.member_achievements enable row level security;
alter table public.rewards             enable row level security;
alter table public.redemptions         enable row level security;
alter table public.feed                enable row level security;
alter table public.reactions           enable row level security;
alter table public.invites             enable row level security;
alter table public.app_settings        enable row level security;

-- ───────────────────────────── политики ─────────────────────────────────────

-- families
drop policy if exists families_select on public.families;
create policy families_select on public.families
  for select to authenticated using (id = public.current_family_id());

drop policy if exists families_admin_update on public.families;
create policy families_admin_update on public.families
  for update to authenticated
  using (public.is_admin() and id = public.current_family_id())
  with check (public.is_admin() and id = public.current_family_id());

-- members: читают все свои, меняет только админ (профиль ребёнка — тоже админ)
drop policy if exists members_select on public.members;
create policy members_select on public.members
  for select to authenticated
  using (family_id = public.current_family_id() and deleted_at is null);

drop policy if exists members_admin_insert on public.members;
create policy members_admin_insert on public.members
  for insert to authenticated
  with check (public.is_admin() and family_id = public.current_family_id());

drop policy if exists members_admin_update on public.members;
create policy members_admin_update on public.members
  for update to authenticated
  using (public.is_admin() and family_id = public.current_family_id())
  with check (public.is_admin() and family_id = public.current_family_id());

-- templates
drop policy if exists templates_select on public.task_templates;
create policy templates_select on public.task_templates
  for select to authenticated using (family_id = public.current_family_id());

drop policy if exists templates_admin_insert on public.task_templates;
create policy templates_admin_insert on public.task_templates
  for insert to authenticated
  with check (public.is_admin() and family_id = public.current_family_id());

drop policy if exists templates_admin_update on public.task_templates;
create policy templates_admin_update on public.task_templates
  for update to authenticated
  using (public.is_admin() and family_id = public.current_family_id())
  with check (public.is_admin() and family_id = public.current_family_id());

drop policy if exists templates_admin_delete on public.task_templates;
create policy templates_admin_delete on public.task_templates
  for delete to authenticated
  using (public.is_admin() and family_id = public.current_family_id());

-- assignments: свои задачи + общая очередь видны всем; запись — только через RPC
drop policy if exists assignments_select on public.assignments;
create policy assignments_select on public.assignments
  for select to authenticated
  using (
    family_id = public.current_family_id()
    and (
      assignee_id = public.current_member_id()
      or assignee_id is null
      or public.is_admin()
    )
  );

-- ledger: свои операции или все админу
drop policy if exists ledger_select on public.ledger;
create policy ledger_select on public.ledger
  for select to authenticated
  using (
    family_id = public.current_family_id()
    and (member_id = public.current_member_id() or public.is_admin())
  );

-- справочники
drop policy if exists levels_select on public.levels;
create policy levels_select on public.levels for select to authenticated using (true);

drop policy if exists achievements_select on public.achievements;
create policy achievements_select on public.achievements for select to authenticated using (true);

drop policy if exists member_achievements_select on public.member_achievements;
create policy member_achievements_select on public.member_achievements
  for select to authenticated
  using (exists (
    select 1 from public.members m
    where m.id = member_achievements.member_id
      and m.family_id = public.current_family_id()
      and m.deleted_at is null
  ));

-- streaks
drop policy if exists streaks_select on public.streaks;
create policy streaks_select on public.streaks
  for select to authenticated
  using (exists (
    select 1 from public.members m
    where m.id = streaks.member_id
      and m.family_id = public.current_family_id()
  ));

-- rewards / redemptions
drop policy if exists rewards_select on public.rewards;
create policy rewards_select on public.rewards
  for select to authenticated using (family_id = public.current_family_id());

drop policy if exists rewards_admin_all on public.rewards;
create policy rewards_admin_all on public.rewards
  for all to authenticated
  using (public.is_admin() and family_id = public.current_family_id())
  with check (public.is_admin() and family_id = public.current_family_id());

drop policy if exists redemptions_select on public.redemptions;
create policy redemptions_select on public.redemptions
  for select to authenticated
  using (
    member_id = public.current_member_id()
    or (public.is_admin() and exists (
      select 1 from public.members m
      where m.id = redemptions.member_id and m.family_id = public.current_family_id()
    ))
  );

-- лента
drop policy if exists feed_select on public.feed;
create policy feed_select on public.feed
  for select to authenticated using (family_id = public.current_family_id());

-- реакции: ставит только свою
drop policy if exists reactions_select on public.reactions;
create policy reactions_select on public.reactions
  for select to authenticated
  using (exists (
    select 1 from public.feed f
    where f.id = reactions.feed_id and f.family_id = public.current_family_id()
  ));

drop policy if exists reactions_insert on public.reactions;
create policy reactions_insert on public.reactions
  for insert to authenticated
  with check (member_id = public.current_member_id());

drop policy if exists reactions_delete on public.reactions;
create policy reactions_delete on public.reactions
  for delete to authenticated using (member_id = public.current_member_id());

-- приглашения — только админ
drop policy if exists invites_admin_select on public.invites;
create policy invites_admin_select on public.invites
  for select to authenticated
  using (public.is_admin() and family_id = public.current_family_id());

-- app_settings: политик нет — доступ только из security definer функций

-- ───────────────────────────── права ────────────────────────────────────────

grant usage on schema public to anon, authenticated;

grant select on public.families, public.members, public.task_templates,
  public.assignments, public.ledger, public.levels, public.streaks,
  public.achievements, public.member_achievements, public.rewards,
  public.redemptions, public.feed, public.reactions, public.invites
  to authenticated;

grant insert, update, delete on public.reactions to authenticated;
grant insert, update, delete on public.task_templates to authenticated;
grant insert, update, delete on public.rewards to authenticated;
grant insert, update on public.members to authenticated;
grant update on public.families to authenticated;
grant insert on public.members to authenticated;

-- запись в домен — только через функции
revoke insert, update, delete on public.assignments from anon, authenticated;
revoke insert, update, delete on public.ledger from anon, authenticated;
revoke insert, update, delete on public.redemptions from anon, authenticated;
revoke all on public.app_settings from anon, authenticated;
revoke all on public.invites from anon;


-- ═══════════════════════════════════════════════════════════════
-- 0003_engine.sql
-- ═══════════════════════════════════════════════════════════════

-- FamilyQuest · 0003 — движок: начисление, одобрение, материализация, прогресс
-- Вся бизнес-логика в SQL: браузер не может подкрутить баллы напрямую.

-- ───────────────────────────── формулы ──────────────────────────────────────

-- Гандикап по возрасту: младшим сложнее даётся та же работа,
-- поэтому коэффициент применяется только к опыту (уровню), не к монетам.
create or replace function public.age_coeff(p_birth date)
returns numeric
language sql
stable
as $$
  select case
    when p_birth is null then 1.0
    when extract(year from age(p_birth)) < 8  then 1.8
    when extract(year from age(p_birth)) < 11 then 1.6
    when extract(year from age(p_birth)) < 14 then 1.4
    when extract(year from age(p_birth)) < 18 then 1.2
    else 1.0
  end::numeric;
$$;

-- Комбо: +0.1 за каждые 3 дня серии, максимум ×2.0 на 30 днях.
create or replace function public.combo_mult(p_streak integer)
returns numeric
language sql
immutable
as $$
  select 1.0 + 0.1 * (least(greatest(coalesce(p_streak, 0), 0), 30) / 3);
$$;

-- ───────────────────────────── лента ────────────────────────────────────────

create or replace function public.push_feed(
  p_family uuid,
  p_kind text,
  p_actor uuid,
  p_subject uuid,
  p_payload jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.feed (family_id, kind, actor_id, subject_id, payload)
  values (p_family, p_kind, p_actor, p_subject, coalesce(p_payload, '{}'::jsonb));
$$;

-- ───────────────────────────── достижения ───────────────────────────────────

create or replace function public.check_achievements(p_member uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_family uuid;
  v_tz text;
  v_total int := 0;
  v_trash int := 0;
  v_kitchen int := 0;
  v_clean int := 0;
  v_night int := 0;
  v_streak int := 0;
  v_before text[] := '{}';
  r record;
begin
  select m.family_id, f.timezone into v_family, v_tz
  from public.members m join public.families f on f.id = m.family_id
  where m.id = p_member;
  if v_family is null then return; end if;

  select count(*),
         count(*) filter (where a.category = 'мусор'),
         count(*) filter (where a.category = 'кухня'),
         count(*) filter (where a.category = 'уборка'),
         count(*) filter (where a.decided_at is not null
                            and extract(hour from (a.decided_at at time zone v_tz)) >= 23)
    into v_total, v_trash, v_kitchen, v_clean, v_night
  from public.assignments a
  where a.assignee_id = p_member and a.status = 'approved';

  select coalesce(s.current, 0) into v_streak from public.streaks s where s.member_id = p_member;
  v_streak := coalesce(v_streak, 0);

  select coalesce(array_agg(ma.code), '{}')
    into v_before
  from public.member_achievements ma
  where ma.member_id = p_member and ma.unlocked_at is not null;

  insert into public.member_achievements (member_id, code, progress, unlocked_at)
  values
    (p_member, 'first_task',  v_total,   case when v_total   >= 1  then now() end),
    (p_member, 'trash_lord',  v_trash,   case when v_trash   >= 25 then now() end),
    (p_member, 'iron_belly',  v_kitchen, case when v_kitchen >= 10 then now() end),
    (p_member, 'clean_hands', v_clean,   case when v_clean   >= 30 then now() end),
    (p_member, 'night_watch', v_night,   case when v_night   >= 1  then now() end),
    (p_member, 'streak_7',    v_streak,  case when v_streak  >= 7  then now() end),
    (p_member, 'streak_30',   v_streak,  case when v_streak  >= 30 then now() end)
  on conflict (member_id, code) do update
    set progress = greatest(public.member_achievements.progress, excluded.progress),
        unlocked_at = coalesce(public.member_achievements.unlocked_at, excluded.unlocked_at);

  for r in
    select ach.code, ach.title, ach.icon
    from public.member_achievements ma
    join public.achievements ach on ach.code = ma.code
    where ma.member_id = p_member
      and ma.unlocked_at is not null
      and not (ach.code = any (v_before))
  loop
    perform public.push_feed(v_family, 'achievement', p_member, p_member,
      jsonb_build_object('code', r.code, 'title', r.title, 'icon', r.icon));
  end loop;
end;
$$;

-- ───────────────────────────── начисление ───────────────────────────────────

create or replace function public.award_internal(
  p_assignment uuid,
  p_by uuid,
  p_late boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  a record;
  m record;
  f record;
  s record;
  v_coins int := 0;
  v_xp int := 0;
  v_mult numeric := 1.0;
  v_age numeric := 1.0;
  v_streak int := 0;
  v_today date;
  v_inserted int := 0;
begin
  select * into a from public.assignments where id = p_assignment for update;
  if not found then raise exception 'assignment_not_found'; end if;
  if a.status = 'approved' then return; end if;

  select * into m from public.members where id = a.assignee_id;
  if not found then raise exception 'member_not_found'; end if;
  select * into f from public.families where id = a.family_id;
  v_today := (now() at time zone f.timezone)::date;

  -- Долг (duty) и опоздание оплачиваются нулём баллов — по правилам игры.
  if a.kind <> 'duty' and a.weight > 0 and not p_late then
    v_mult := coalesce((f.settings ->> 'event_multiplier')::numeric, 1.0);
    if v_mult <= 0 then v_mult := 1.0; end if;

    select * into s from public.streaks where member_id = a.assignee_id;
    if found and s.last_day = v_today then
      v_streak := greatest(s.current, 1);
    elsif found and s.last_day = v_today - 1 then
      v_streak := s.current + 1;
    else
      v_streak := 1;
    end if;

    v_age := public.age_coeff(m.birth_date);
    v_coins := round(a.weight * v_mult);
    v_xp := round(v_coins * v_age * public.combo_mult(v_streak));

    insert into public.streaks (member_id, current, best, last_day, updated_at)
    values (a.assignee_id, v_streak, v_streak, v_today, now())
    on conflict (member_id) do update
      set current = v_streak,
          best = greatest(public.streaks.best, v_streak),
          last_day = v_today,
          updated_at = now();
  end if;

  insert into public.ledger (family_id, member_id, coins, xp, kind, ref_type, ref_id,
                             note, idempotency_key, created_by)
  values (a.family_id, a.assignee_id, v_coins, v_xp, 'award', 'assignment', a.id,
          a.title, 'assign:' || a.id::text, p_by)
  on conflict (idempotency_key) do nothing;
  get diagnostics v_inserted = row_count;

  if v_inserted > 0 and (v_coins <> 0 or v_xp <> 0) then
    update public.members
      set coins = coins + v_coins, xp_total = xp_total + v_xp
    where id = a.assignee_id;
  end if;

  update public.assignments
    set status = 'approved',
        decided_at = now(),
        decided_by = p_by,
        coins_awarded = v_coins,
        xp_awarded = v_xp
  where id = a.id;

  perform public.push_feed(
    a.family_id,
    case when p_late then 'task_late' else 'task_done' end,
    a.assignee_id, a.assignee_id,
    jsonb_build_object('assignment', a.id, 'title', a.title, 'category', a.category,
                       'coins', v_coins, 'xp', v_xp, 'late', p_late));

  perform public.check_achievements(a.assignee_id);
end;
$$;

-- ───────────────────────────── действия участника ───────────────────────────

create or replace function public.complete_assignment(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  a record;
  v_me uuid := public.current_member_id();
  v_admin boolean := public.is_admin();
  v_late boolean;
begin
  if v_me is null then raise exception 'not_member'; end if;

  select * into a from public.assignments where id = p_id for update;
  if not found then raise exception 'assignment_not_found'; end if;
  if a.family_id <> public.current_family_id() then raise exception 'forbidden'; end if;
  if a.status <> 'pending' then raise exception 'not_pending'; end if;

  -- задача из общей очереди: кто первый выполнил, тот её и забрал
  if a.assignee_id is null then
    update public.assignments set assignee_id = v_me where id = p_id;
    perform public.push_feed(a.family_id, 'task_claimed', v_me, v_me,
      jsonb_build_object('assignment', a.id, 'title', a.title, 'category', a.category));
    a.assignee_id := v_me;
  end if;

  if a.assignee_id <> v_me and not v_admin then raise exception 'forbidden'; end if;

  v_late := a.due_at is not null and now() > a.due_at;

  if a.approval = 'auto' or v_admin then
    perform public.award_internal(p_id, v_me, v_late);
  else
    update public.assignments
      set status = 'submitted', submitted_at = now()
    where id = p_id;
    perform public.push_feed(a.family_id, 'task_submitted', v_me, a.assignee_id,
      jsonb_build_object('assignment', p_id, 'title', a.title, 'category', a.category));
  end if;

  return (
    select jsonb_build_object('id', x.id, 'status', x.status,
                              'coins', x.coins_awarded, 'xp', x.xp_awarded)
    from public.assignments x where x.id = p_id
  );
end;
$$;

-- ── общая очередь: взять задачу себе / вернуть обратно ──────────────────────

create or replace function public.claim_assignment(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  a record;
  v_me uuid := public.current_member_id();
begin
  if v_me is null then raise exception 'not_member'; end if;

  select * into a from public.assignments where id = p_id for update;
  if not found then raise exception 'assignment_not_found'; end if;
  if a.family_id <> public.current_family_id() then raise exception 'forbidden'; end if;
  if a.status <> 'pending' then raise exception 'not_pending'; end if;
  if a.assignee_id = v_me then
    return jsonb_build_object('id', p_id, 'status', a.status, 'mine', true);
  end if;
  if a.assignee_id is not null then raise exception 'already_taken'; end if;

  update public.assignments set assignee_id = v_me where id = p_id;

  perform public.push_feed(a.family_id, 'task_claimed', v_me, v_me,
    jsonb_build_object('assignment', a.id, 'title', a.title, 'category', a.category));

  return jsonb_build_object('id', p_id, 'status', a.status, 'mine', true);
end;
$$;

create or replace function public.release_assignment(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  a record;
  v_me uuid := public.current_member_id();
  v_admin boolean := public.is_admin();
begin
  if v_me is null then raise exception 'not_member'; end if;

  select * into a from public.assignments where id = p_id for update;
  if not found then raise exception 'assignment_not_found'; end if;
  if a.family_id <> public.current_family_id() then raise exception 'forbidden'; end if;
  if a.assignee_id is null then
    return jsonb_build_object('id', p_id, 'status', a.status, 'pool', true);
  end if;
  if a.status <> 'pending' then raise exception 'not_pending'; end if;
  if a.assignee_id <> v_me and not v_admin then raise exception 'forbidden'; end if;

  update public.assignments set assignee_id = null where id = p_id;

  perform public.push_feed(a.family_id, 'task_released', v_me, a.assignee_id,
    jsonb_build_object('assignment', a.id, 'title', a.title));

  return jsonb_build_object('id', p_id, 'status', a.status, 'pool', true);
end;
$$;

create or replace function public.approve_assignment(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  a record;
  v_me uuid := public.current_member_id();
  v_late boolean;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;

  select * into a from public.assignments where id = p_id for update;
  if not found then raise exception 'assignment_not_found'; end if;
  if a.family_id <> public.current_family_id() then raise exception 'forbidden'; end if;
  if a.status not in ('submitted', 'pending') then raise exception 'not_awaiting'; end if;

  v_late := a.due_at is not null and coalesce(a.submitted_at, now()) > a.due_at;
  perform public.award_internal(p_id, v_me, v_late);

  return (select jsonb_build_object('id', x.id, 'status', x.status,
                                    'coins', x.coins_awarded, 'xp', x.xp_awarded)
          from public.assignments x where x.id = p_id);
end;
$$;

create or replace function public.reject_assignment(p_id uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  a record;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;

  select * into a from public.assignments where id = p_id for update;
  if not found then raise exception 'assignment_not_found'; end if;
  if a.family_id <> public.current_family_id() then raise exception 'forbidden'; end if;
  if a.status <> 'submitted' then raise exception 'not_submitted'; end if;

  update public.assignments
    set status = 'rejected', decided_at = now(), decided_by = public.current_member_id(),
        note = coalesce(p_reason, note)
  where id = p_id;

  perform public.push_feed(a.family_id, 'task_rejected', public.current_member_id(), a.assignee_id,
    jsonb_build_object('assignment', a.id, 'title', a.title, 'reason', coalesce(p_reason, '')));

  return jsonb_build_object('id', p_id, 'status', 'rejected');
end;
$$;

-- «Простить»: задача закрывается без баллов, комбо не ломается.
create or replace function public.waive_assignment(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  a record;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;

  select * into a from public.assignments where id = p_id for update;
  if not found then raise exception 'assignment_not_found'; end if;
  if a.family_id <> public.current_family_id() then raise exception 'forbidden'; end if;
  if a.status in ('approved', 'skipped') then raise exception 'already_closed'; end if;

  update public.assignments
    set status = 'skipped', decided_at = now(), decided_by = public.current_member_id()
  where id = p_id;

  perform public.push_feed(a.family_id, 'task_waived', public.current_member_id(), a.assignee_id,
    jsonb_build_object('assignment', a.id, 'title', a.title));

  return jsonb_build_object('id', p_id, 'status', 'skipped');
end;
$$;

-- ───────────────────────────── фоновые операции ─────────────────────────────

create or replace function public.materialize_daily(
  p_family uuid default null,
  p_date date default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int := 0;
begin
  insert into public.assignments (family_id, template_id, title, category, assignee_id,
                                  created_by, kind, weight, approval, due_date, due_at, source)
  select t.family_id, t.id, t.title, t.category, t.assignee_id,
         t.created_by, t.kind, t.base_weight, t.approval, d.day,
         -- Если день сегодняшний, а время дедлайна уже прошло (например, задачи
         -- создаются в 21:00, а «завтрак» был в 08:30) — создаём задачу БЕЗ дедлайна,
         -- иначе она родится сразу просроченной.
         case
           when d.day = (now() at time zone f.timezone)::date
                and ((d.day + coalesce(t.due_time, time '23:59')) at time zone f.timezone) < now()
             then null
           else ((d.day + coalesce(t.due_time, time '23:59')) at time zone f.timezone)
         end,
         'template'
  from public.task_templates t
  join public.families f on f.id = t.family_id
  cross join lateral (
    select coalesce(p_date, (now() at time zone f.timezone)::date) as day
  ) d
  where t.active
    and (p_family is null or t.family_id = p_family)
    and (
      t.recurrence = 'daily'
      or (t.recurrence = 'weekly'
          and extract(isodow from d.day)::int = any (coalesce(t.weekdays,
                array[extract(isodow from d.day)::int])))
      or (t.recurrence = 'monthly' and extract(day from d.day)::int = 1)
    )
  on conflict do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Закрыть просроченные. Штрафы по умолчанию выключены
-- (families.settings->>'fines_enabled' = 'true' включает мягкий штраф 20%).
create or replace function public.close_overdue()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_count int := 0;
  v_penalty int;
  v_coins int;
  v_inserted int;
begin
  for r in
    select a.id, a.family_id, a.assignee_id, a.title, a.weight, a.kind,
           coalesce((f.settings ->> 'fines_enabled')::boolean, false) as fines
    from public.assignments a
    join public.families f on f.id = a.family_id
    where a.status = 'pending' and a.due_at is not null and a.due_at < now()
    for update of a skip locked
  loop
    -- Никто не взял задачу из общей очереди — убираем молча, виноватых нет.
    if r.assignee_id is null then
      update public.assignments
        set status = 'skipped', decided_at = now()
      where id = r.id;
      v_count := v_count + 1;
      continue;
    end if;

    -- Долг не «просрочивается»: закрываем молча, без штрафа и без записи в ленте.
    if r.kind = 'duty' or r.weight = 0 then
      update public.assignments
        set status = 'skipped', decided_at = now()
      where id = r.id;
      v_count := v_count + 1;
      continue;
    end if;

    update public.assignments
      set status = 'missed', decided_at = now()
    where id = r.id;

    perform public.push_feed(r.family_id, 'task_missed', r.assignee_id, r.assignee_id,
      jsonb_build_object('assignment', r.id, 'title', r.title));

    if r.fines and r.weight > 0 then
      v_penalty := round(r.weight * 0.2)::int;
      select coins into v_coins from public.members where id = r.assignee_id;
      v_penalty := least(v_penalty, coalesce(v_coins, 0));

      if v_penalty > 0 then
        insert into public.ledger (family_id, member_id, coins, xp, kind, ref_type, ref_id,
                                   note, idempotency_key)
        values (r.family_id, r.assignee_id, -v_penalty, 0, 'penalty', 'assignment', r.id,
                r.title, 'penalty:' || r.id::text)
        on conflict (idempotency_key) do nothing;
        get diagnostics v_inserted = row_count;
        if v_inserted > 0 then
          update public.members set coins = coins - v_penalty where id = r.assignee_id;
        end if;
      end if;
    end if;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- ───────────────────────────── чтение для клиента ───────────────────────────

-- Список для экрана входа: доступен без авторизации, только имя/аватар.
-- Состав возвращаемых колонок меняется, а PostgreSQL не позволяет изменить его
-- через create or replace — поэтому удаляем функцию перед созданием.
drop function if exists public.login_members();

create or replace function public.login_members()
returns table (login text, display_name text, emoji text, color text, avatar_url text, role text)
language sql
stable
security definer
set search_path = public
as $$
  select m.login, m.display_name, m.emoji, m.color, m.avatar_url, m.role
  from public.members m
  where m.user_id is not null and m.deleted_at is null
  order by case when m.role = 'admin' then 0 else 1 end, m.created_at;
$$;

create or replace function public.my_profile()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  m record;
  f record;
  v_level record;
  v_next record;
  s record;
  v_today date;
  v_badges int := 0;
  v_open int := 0;
  v_streak int := 0;
begin
  select * into m from public.members where user_id = auth.uid() and deleted_at is null limit 1;
  if not found then return null; end if;

  select * into f from public.families where id = m.family_id;
  v_today := (now() at time zone f.timezone)::date;

  select * into v_level from public.levels where xp_threshold <= m.xp_total
    order by xp_threshold desc limit 1;
  select * into v_next from public.levels where xp_threshold > m.xp_total
    order by xp_threshold asc limit 1;

  select * into s from public.streaks where member_id = m.id;
  if found and s.last_day >= v_today - 1 then
    v_streak := s.current;
  end if;

  select count(*) into v_badges from public.member_achievements
    where member_id = m.id and unlocked_at is not null;

  select count(*) into v_open from public.assignments
    where (assignee_id = m.id or assignee_id is null)
      and status in ('pending', 'submitted')
      and (due_date = v_today or due_date is null or due_date < v_today);

  return jsonb_build_object(
    'id', m.id,
    'display_name', m.display_name,
    'emoji', m.emoji,
    'color', m.color,
    'avatar_url', m.avatar_url,
    'role', m.role,
    'login', m.login,
    'birth_date', m.birth_date,
    'age', case when m.birth_date is null then null
                else extract(year from age(m.birth_date))::int end,
    'coins', m.coins,
    'xp_total', m.xp_total,
    'level', jsonb_build_object(
      'idx', coalesce(v_level.idx, 0),
      'name', coalesce(v_level.name, 'Новичок'),
      'threshold', coalesce(v_level.xp_threshold, 0)),
    'next_level', case when v_next.idx is null then null
                       else jsonb_build_object('idx', v_next.idx, 'name', v_next.name,
                                               'threshold', v_next.xp_threshold) end,
    'streak', v_streak,
    'streak_best', coalesce(s.best, 0),
    'streak_freezes', coalesce(s.freezes, 0),
    'badges', v_badges,
    'open_tasks', v_open,
    'today', v_today,
    'family', jsonb_build_object('id', f.id, 'name', f.name, 'timezone', f.timezone,
                                 'coin_name', f.coin_name)
  );
end;
$$;

create or replace function public.my_today(p_date date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  m record;
  f record;
  v_day date;
  v_result jsonb;
begin
  select * into m from public.members where user_id = auth.uid() and deleted_at is null limit 1;
  if not found then return '[]'::jsonb; end if;

  select * into f from public.families where id = m.family_id;
  v_day := coalesce(p_date, (now() at time zone f.timezone)::date);

  select coalesce(
           jsonb_agg(to_jsonb(x) - 'sort_due'
                     order by x.sort_due nulls last, x.weight desc),
           '[]'::jsonb)
    into v_result
  from (
    select a.id, a.title, a.category, a.kind, a.weight, a.approval, a.status,
           a.due_at, a.due_date, a.coins_awarded, a.xp_awarded, a.source,
           a.submitted_at, a.decided_at,
           (a.assignee_id is null) as in_pool,
           (a.assignee_id = m.id) as mine,
           case when a.due_at is not null and now() > a.due_at and a.status = 'pending'
                then true else false end as overdue,
           coalesce(a.due_at, a.created_at) as sort_due
    from public.assignments a
    where (a.assignee_id = m.id or a.assignee_id is null)
      and a.status <> 'skipped'
      and (a.due_date = v_day
           or a.due_date is null
           or (a.due_date < v_day and a.status = 'pending'))
  ) x;

  return v_result;
end;
$$;

create or replace function public.family_feed(p_limit integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_family uuid := public.current_family_id();
  v_result jsonb;
begin
  if v_family is null then return '[]'::jsonb; end if;

  select coalesce(
           jsonb_agg(to_jsonb(x) order by x.created_at desc),
           '[]'::jsonb)
    into v_result
  from (
    select fe.id, fe.kind, fe.payload, fe.created_at,
           actor.display_name as actor_name,
           actor.emoji as actor_emoji,
           actor.color as actor_color,
           actor.avatar_url as actor_avatar_url,
           subject.display_name as subject_name,
           coalesce((
             select jsonb_agg(jsonb_build_object('emoji', r.emoji, 'member', r.member_id))
             from public.reactions r where r.feed_id = fe.id
           ), '[]'::jsonb) as reactions
    from public.feed fe
    left join public.members actor on actor.id = fe.actor_id
    left join public.members subject on subject.id = fe.subject_id
    where fe.family_id = v_family
    order by fe.created_at desc
    limit greatest(1, least(coalesce(p_limit, 30), 100))
  ) x;

  return v_result;
end;
$$;

-- Очередь на одобрение + картина дня для админа.
create or replace function public.admin_queue()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_family uuid := public.current_family_id();
  v_today date;
  v_submitted jsonb;
  v_today_tasks jsonb;
  v_members jsonb;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;

  select (now() at time zone f.timezone)::date into v_today
  from public.families f where f.id = v_family;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.submitted_at), '[]'::jsonb)
    into v_submitted
  from (
    select a.id, a.title, a.category, a.weight, a.status, a.due_at, a.submitted_at,
           m.display_name as assignee_name, m.emoji as assignee_emoji, m.color as assignee_color,
           false as in_pool
    from public.assignments a
    join public.members m on m.id = a.assignee_id
    where a.family_id = v_family and a.status = 'submitted'
  ) x;

  select coalesce(jsonb_agg(to_jsonb(y) order by y.in_pool desc, y.due_at nulls last), '[]'::jsonb)
    into v_today_tasks
  from (
    select a.id, a.title, a.category, a.weight, a.status, a.due_at, a.approval,
           m.display_name as assignee_name, coalesce(m.emoji, '📥') as assignee_emoji,
           (a.assignee_id is null) as in_pool
    from public.assignments a
    left join public.members m on m.id = a.assignee_id
    where a.family_id = v_family and a.due_date = v_today
  ) y;

  select coalesce(jsonb_agg(to_jsonb(z) order by z.display_name), '[]'::jsonb)
    into v_members
  from (
    select m.id, m.login, m.display_name, m.emoji, m.color, m.avatar_url, m.role, m.birth_date,
           m.coins, m.xp_total, m.user_id is not null as has_account,
           case when m.birth_date is null then null
                else extract(year from age(m.birth_date))::int end as age
    from public.members m
    where m.family_id = v_family and m.deleted_at is null
  ) z;

  return jsonb_build_object(
    'date', v_today,
    'submitted', v_submitted,
    'today', v_today_tasks,
    'members', v_members
  );
end;
$$;

create or replace function public.my_rewards()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_family uuid := public.current_family_id();
  v_me uuid := public.current_member_id();
  v_result jsonb;
begin
  if v_family is null then return '{"rewards": [], "redemptions": []}'::jsonb; end if;

  select jsonb_build_object(
    'rewards', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.price_coins)
      from (
        select rw.id, rw.title, rw.description, rw.tier, rw.price_coins, rw.stock
        from public.rewards rw
        where rw.family_id = v_family and rw.active
          and (rw.stock is null or rw.stock > 0)
      ) r), '[]'::jsonb),
    'redemptions', coalesce((
      select jsonb_agg(to_jsonb(rd) order by rd.created_at desc)
      from (
        select rp.id, rp.status, rp.coins_spent, rp.created_at,
               rw.title
        from public.redemptions rp
        join public.rewards rw on rw.id = rp.reward_id
        where rp.member_id = v_me
      ) rd), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

-- ───────────────────────────── управление семьёй ────────────────────────────

create or replace function public.create_member(
  p_display_name text,
  p_role text,
  p_login text,
  p_birth_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_family uuid := public.current_family_id();
  v_member uuid;
  v_code text;
  v_login text := lower(regexp_replace(coalesce(p_login, ''), '[^a-zA-Z0-9_]', '', 'g'));
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if v_login = '' then raise exception 'login_required'; end if;
  if p_role not in ('admin', 'child') then raise exception 'bad_role'; end if;

  insert into public.members (family_id, login, role, display_name, birth_date)
  values (v_family, v_login, p_role, p_display_name, p_birth_date)
  returning id into v_member;

  insert into public.streaks (member_id) values (v_member) on conflict do nothing;

  v_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
  insert into public.invites (code, family_id, member_id, role)
  values (v_code, v_family, v_member, p_role);

  return jsonb_build_object('member_id', v_member, 'login', v_login, 'code', v_code);
end;
$$;

create or replace function public.create_invite(p_member uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_family uuid := public.current_family_id();
  v_role text;
  v_code text;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;

  select role into v_role from public.members
  where id = p_member and family_id = v_family;
  if not found then raise exception 'member_not_found'; end if;

  v_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
  insert into public.invites (code, family_id, member_id, role)
  values (v_code, v_family, p_member, v_role);

  return v_code;
end;
$$;

create or replace function public.redeem_reward(p_reward_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  m record;
  v_redemption uuid;
begin
  select * into m from public.members where user_id = auth.uid() and deleted_at is null limit 1;
  if not found then raise exception 'not_member'; end if;

  select * into r from public.rewards where id = p_reward_id and active for update;
  if not found then raise exception 'reward_not_found'; end if;
  if r.family_id <> m.family_id then raise exception 'forbidden'; end if;
  if r.price_coins > m.coins then raise exception 'not_enough_coins'; end if;
  if r.stock is not null and r.stock <= 0 then raise exception 'out_of_stock'; end if;

  insert into public.redemptions (member_id, reward_id, coins_spent)
  values (m.id, r.id, r.price_coins)
  returning id into v_redemption;

  insert into public.ledger (family_id, member_id, coins, xp, kind, ref_type, ref_id,
                             note, idempotency_key, created_by)
  values (r.family_id, m.id, -r.price_coins, 0, 'reward', 'redemption', v_redemption,
          r.title, 'redeem:' || v_redemption::text, m.id);

  update public.members set coins = coins - r.price_coins where id = m.id;
  if r.stock is not null then
    update public.rewards set stock = stock - 1 where id = r.id;
  end if;

  perform public.push_feed(r.family_id, 'reward_redeemed', m.id, m.id,
    jsonb_build_object('reward', r.title, 'coins', r.price_coins, 'redemption', v_redemption));

  return jsonb_build_object('redemption_id', v_redemption, 'coins_spent', r.price_coins);
end;
$$;

-- ───────────────────────────── регистрация участника ────────────────────────

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text := upper(nullif(btrim(coalesce(new.raw_user_meta_data ->> 'invite', '')), ''));
  v_login text := lower(nullif(btrim(coalesce(new.raw_user_meta_data ->> 'login', '')), ''));
  v_name text := coalesce(nullif(btrim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), ''),
                          split_part(new.email, '@', 1));
  v_inv public.invites;
  v_member public.members;
begin
  if v_code is null then
    return new;  -- регистрация без инвайта: доступа к данным не будет
  end if;

  select * into v_inv from public.invites where code = v_code for update;
  if not found then raise exception 'invite_not_found'; end if;
  if v_inv.used_at is not null then raise exception 'invite_used'; end if;
  if v_inv.expires_at is not null and v_inv.expires_at < now() then
    raise exception 'invite_expired';
  end if;

  if v_inv.member_id is not null then
    update public.members
      set user_id = new.id,
          login = coalesce(public.members.login, v_login, split_part(new.email, '@', 1))
    where id = v_inv.member_id
    returning * into v_member;
  else
    insert into public.members (family_id, user_id, login, role, display_name)
    values (v_inv.family_id, new.id,
            coalesce(v_login, split_part(new.email, '@', 1)),
            v_inv.role, v_name)
    returning * into v_member;
  end if;

  update public.invites set used_at = now(), used_by = new.id where code = v_inv.code;

  insert into public.streaks (member_id) values (v_member.id) on conflict do nothing;

  perform public.push_feed(v_member.family_id, 'member_joined', v_member.id, v_member.id,
    jsonb_build_object('name', v_member.display_name));

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ───────────────────────────── права на функции ─────────────────────────────

do $$
declare
  s text;
begin
  foreach s in array array[
    'public.current_member_id()',
    'public.current_family_id()',
    'public.is_admin()',
    'public.age_coeff(date)',
    'public.combo_mult(integer)',
    'public.push_feed(uuid, text, uuid, uuid, jsonb)',
    'public.check_achievements(uuid)',
    'public.award_internal(uuid, uuid, boolean)',
    'public.complete_assignment(uuid)',
    'public.claim_assignment(uuid)',
    'public.release_assignment(uuid)',
    'public.approve_assignment(uuid)',
    'public.reject_assignment(uuid, text)',
    'public.waive_assignment(uuid)',
    'public.materialize_daily(uuid, date)',
    'public.close_overdue()',
    'public.my_profile()',
    'public.my_today(date)',
    'public.family_feed(integer)',
    'public.admin_queue()',
    'public.my_rewards()',
    'public.create_member(text, text, text, date)',
    'public.create_invite(uuid)',
    'public.redeem_reward(uuid)'
  ]
  loop
    execute format('revoke all on function %s from public, anon', s);
    execute format('grant execute on function %s to authenticated', s);
  end loop;

  -- экран входа работает без авторизации
  execute 'revoke all on function public.login_members() from public';
  execute 'grant execute on function public.login_members() to anon, authenticated';
  execute 'grant execute on function public.handle_new_user() to supabase_auth_admin, postgres, service_role';
end;
$$;

-- ───────────────────────────── разовая задача (админ) ───────────────────────

create or replace function public.create_oneoff_assignment(
  p_title text,
  p_assignee uuid,
  p_weight integer,
  p_category text,
  p_due_at timestamptz,
  p_approval text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_family uuid := public.current_family_id();
  v_tz text;
  v_id uuid;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;

  select timezone into v_tz from public.families where id = v_family;

  insert into public.assignments (family_id, title, category, assignee_id, created_by,
                                  kind, weight, approval, due_date, due_at, source)
  values (
    v_family,
    coalesce(nullif(btrim(p_title), ''), 'Задача'),
    coalesce(nullif(btrim(p_category), ''), 'дом'),
    p_assignee,
    public.current_member_id(),
    case when coalesce(p_weight, 0) <= 0 then 'duty' else 'quest' end,
    greatest(coalesce(p_weight, 0), 0),
    case when p_approval = 'review' then 'review' else 'auto' end,
    case when p_due_at is null then null
         else (p_due_at at time zone v_tz)::date end,
    p_due_at,
    'manual'
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.create_oneoff_assignment(text, uuid, integer, text, timestamptz, text)
  from public, anon;
grant execute on function public.create_oneoff_assignment(text, uuid, integer, text, timestamptz, text)
  to authenticated;


-- ═══════════════════════════════════════════════════════════════
-- 0004_cron.sql
-- ═══════════════════════════════════════════════════════════════

-- FamilyQuest · 0004 — расписание (pg_cron)
-- Supabase free tier: pg_cron есть в списке расширений, включается этим файлом.
-- Время в UTC. Москва = UTC+3, поэтому «00:05 по Москве» = 21:05 UTC.

create extension if not exists pg_cron;

do $$
declare
  j bigint;
begin
  -- снимаем прошлые задания, чтобы файл можно было применять повторно
  for j in select jobid from cron.job where jobname like 'fq-%'
  loop
    perform cron.unschedule(j);
  end loop;

  -- создать экземпляры ежедневных/еженедельных задач на новый день
  perform cron.schedule(
    'fq-materialize',
    '5 21 * * *',
    $cron$ select public.materialize_daily(); $cron$
  );

  -- заняться просрочками и напомнить о дедлайнах
  perform cron.schedule(
    'fq-close-overdue',
    '*/5 * * * *',
    $cron$ select public.close_overdue(); $cron$
  );
exception
  when others then
    raise notice 'pg_cron не настроен (%): %', sqlstate, sqlerrm;
end;
$$;

-- Полезное для проверки:
--   select jobid, jobname, schedule, active from cron.job order by jobid;
--   select * from cron.job_run_details order by start_time desc limit 20;


-- ═══════════════════════════════════════════════════════════════
-- 0005_seed.sql
-- ═══════════════════════════════════════════════════════════════

-- FamilyQuest · 0005 — стартовые данные (семья, уровни, задачи, призы)
-- Файл идемпотентен: повторное применение ничего не дублирует.
--
-- ВАЖНО: даты рождения ниже — заглушки (год посчитан по возрасту 38/35/10 на 2026-й).
-- Поставь точные: админка → Участники, или SQL:
--   update public.members set birth_date = '1988-04-12' where login = 'papa';

-- ───────────────────────────── семья ────────────────────────────────────────

insert into public.families (id, name, timezone, coin_name, xp_name, settings)
values ('11111111-1111-1111-1111-111111111111', 'Наша семья', 'Europe/Moscow', 'монеты', 'опыт',
        jsonb_build_object('fines_enabled', false, 'event_multiplier', 1))
on conflict (id) do nothing;

-- ───────────────────────────── участники ────────────────────────────────────

insert into public.members (id, family_id, login, role, display_name, emoji, color, birth_date)
values
  ('22222222-2222-2222-2222-222222222201', '11111111-1111-1111-1111-111111111111',
   'papa',    'admin', 'Папа',   '🧔', '#6aa8ff', '1988-03-15'),
  ('22222222-2222-2222-2222-222222222202', '11111111-1111-1111-1111-111111111111',
   'mama',    'admin', 'Мама',   '👩', '#e07a9b', '1991-06-20'),
  ('22222222-2222-2222-2222-222222222203', '11111111-1111-1111-1111-111111111111',
   'alyosha', 'child', 'Алёша',  '🧒', '#7ecb8f', '2016-02-10')
on conflict (id) do nothing;

insert into public.streaks (member_id)
select id from public.members where family_id = '11111111-1111-1111-1111-111111111111'
on conflict (member_id) do nothing;

-- Портреты из public/art (см. ART.md). Путь относительный — работает и в корне домена,
-- и в подпапке GitHub Pages.
update public.members set avatar_url = './art/avatar-papa.webp'    where login = 'papa';
update public.members set avatar_url = './art/avatar-mama.webp'    where login = 'mama';
update public.members set avatar_url = './art/avatar-alyosha.webp' where login = 'alyosha';

-- ───────────────────────────── уровни ───────────────────────────────────────
-- Прогресс монотонный: опыт не снимается, поэтому понизить уровень нельзя.

insert into public.levels (idx, name, xp_threshold) values
  (1,  'Новичок',          0),
  (2,  'Ученик',         100),
  (3,  'Подмастерье',    250),
  (4,  'Хозяин',         450),
  (5,  'Мастер',         700),
  (6,  'Магистр',       1000),
  (7,  'Хранитель Очага', 1400),
  (8,  'Сенешаль',      1900),
  (9,  'Властелин Пыли', 2500),
  (10, 'Сэр Чистые Руки', 3200),
  (11, 'Легенда очага',  4000),
  (12, 'Легенда семьи',  5000)
on conflict (idx) do update set name = excluded.name, xp_threshold = excluded.xp_threshold;

-- ───────────────────────────── достижения ───────────────────────────────────

insert into public.achievements (code, title, description, hidden, icon, rule) values
  ('first_task',  'Первый шаг',          'Первая закрытая задача',                      false, '🎯', '{"type":"count","n":1}'),
  ('trash_lord',  'Повелитель мусора',   '25 раз вынести мусор',                        false, '🗑️', '{"type":"count","category":"мусор","n":25}'),
  ('iron_belly',  'Железный желудок',    '10 задач на кухне',                           false, '🍳', '{"type":"count","category":"кухня","n":10}'),
  ('clean_hands', 'Сэр Чистые Руки',     '30 задач по уборке',                          false, '🧼', '{"type":"count","category":"уборка","n":30}'),
  ('night_watch', 'Ночной дозор',        'Закрыть задачу после 23:00',                  true,  '🌙', '{"type":"night"}'),
  ('streak_7',    'Неделя без пропусков','7 дней подряд с выполненной задачей',          false, '🔥', '{"type":"streak","n":7}'),
  ('streak_30',   'Месяц в ритме',       '30 дней подряд с выполненной задачей',         true,  '🏆', '{"type":"streak","n":30}')
on conflict (code) do update set
  title = excluded.title, description = excluded.description,
  hidden = excluded.hidden, icon = excluded.icon, rule = excluded.rule;

-- ───────────────────────────── шаблоны задач ────────────────────────────────

insert into public.task_templates
  (id, family_id, assignee_id, title, category, kind, base_weight, recurrence, weekdays,
   due_time, approval, active)
values
  -- Папа
  ('33333333-3333-3333-3333-333333333301', '11111111-1111-1111-1111-111111111111',
   '22222222-2222-2222-2222-222222222201', 'Оплатить квитанции', 'бюрократия', 'quest', 20,
   'monthly', null, '20:00', 'review', true),
  ('33333333-3333-3333-3333-333333333302', '11111111-1111-1111-1111-111111111111',
   '22222222-2222-2222-2222-222222222201', 'Сходить в магазин', 'дом', 'quest', 25,
   'weekly', array[6], '18:00', 'review', true),
  ('33333333-3333-3333-3333-333333333303', '11111111-1111-1111-1111-111111111111',
   '22222222-2222-2222-2222-222222222201', 'Своя посуда', 'кухня', 'duty', 0,
   'daily', null, '21:00', 'auto', true),

  -- Мама
  ('33333333-3333-3333-3333-333333333304', '11111111-1111-1111-1111-111111111111',
   '22222222-2222-2222-2222-222222222202', 'Приготовить ужин', 'кухня', 'quest', 30,
   'daily', null, '19:00', 'review', true),
  ('33333333-3333-3333-3333-333333333305', '11111111-1111-1111-1111-111111111111',
   '22222222-2222-2222-2222-222222222202', 'Помыть полы', 'уборка', 'quest', 20,
   'weekly', array[6], '12:00', 'review', true),
  ('33333333-3333-3333-3333-333333333306', '11111111-1111-1111-1111-111111111111',
   '22222222-2222-2222-2222-222222222202', 'Постирать и развесить бельё', 'дом', 'quest', 25,
   'weekly', array[3], '11:00', 'auto', true),

  -- Алёша
  ('33333333-3333-3333-3333-333333333307', '11111111-1111-1111-1111-111111111111',
   '22222222-2222-2222-2222-222222222203', 'Своя комната', 'дом', 'duty', 0,
   'daily', null, '20:30', 'auto', true),
  ('33333333-3333-3333-3333-333333333308', '11111111-1111-1111-1111-111111111111',
   '22222222-2222-2222-2222-222222222203', 'Своя посуда', 'кухня', 'duty', 0,
   'daily', null, '21:00', 'auto', true),
  ('33333333-3333-3333-3333-333333333309', '11111111-1111-1111-1111-111111111111',
   '22222222-2222-2222-2222-222222222203', 'Вынести мусор', 'мусор', 'quest', 10,
   'daily', null, '19:30', 'auto', true),
  ('33333333-3333-3333-3333-333333333310', '11111111-1111-1111-1111-111111111111',
   '22222222-2222-2222-2222-222222222203', 'Погулять с собакой', 'питомцы', 'quest', 12,
   'daily', null, '18:00', 'auto', true),
  ('33333333-3333-3333-3333-333333333311', '11111111-1111-1111-1111-111111111111',
   '22222222-2222-2222-2222-222222222203', 'Зарядка 15 минут', 'развитие', 'quest', 8,
   'daily', null, '08:30', 'auto', true),
  ('33333333-3333-3333-3333-333333333312', '11111111-1111-1111-1111-111111111111',
   '22222222-2222-2222-2222-222222222203', 'Прочитать 30 страниц', 'развитие', 'quest', 15,
   'daily', null, '21:30', 'review', true),
  ('33333333-3333-3333-3333-333333333313', '11111111-1111-1111-1111-111111111111',
   '22222222-2222-2222-2222-222222222203', 'Помыть посуду за всех', 'кухня', 'quest', 15,
   'daily', null, '20:00', 'auto', true),
  ('33333333-3333-3333-3333-333333333314', '11111111-1111-1111-1111-111111111111',
   '22222222-2222-2222-2222-222222222203', 'Пропылесосить', 'уборка', 'quest', 25,
   'weekly', array[6], '11:00', 'review', true),
  ('33333333-3333-3333-3333-333333333315', '11111111-1111-1111-1111-111111111111',
   '22222222-2222-2222-2222-222222222203', 'Полить цветы', 'дом', 'quest', 8,
   'weekly', array[2], '17:00', 'auto', true),

  -- ещё несколько ежедневных дел родителям, чтобы доска не пустовала
  ('33333333-3333-3333-3333-333333333316', '11111111-1111-1111-1111-111111111111',
   '22222222-2222-2222-2222-222222222201', 'Приготовить завтрак', 'кухня', 'quest', 20,
   'daily', null, '08:30', 'review', true),
  ('33333333-3333-3333-3333-333333333317', '11111111-1111-1111-1111-111111111111',
   '22222222-2222-2222-2222-222222222201', 'Вынести мусор вечером', 'мусор', 'quest', 10,
   'daily', null, '19:30', 'auto', true),
  ('33333333-3333-3333-3333-333333333318', '11111111-1111-1111-1111-111111111111',
   '22222222-2222-2222-2222-222222222201', 'Помыть посуду после ужина', 'кухня', 'quest', 15,
   'daily', null, '20:45', 'auto', true),
  ('33333333-3333-3333-3333-333333333319', '11111111-1111-1111-1111-111111111111',
   '22222222-2222-2222-2222-222222222202', 'Помыть посуду после завтрака', 'кухня', 'quest', 12,
   'daily', null, '09:30', 'auto', true),
  ('33333333-3333-3333-3333-333333333320', '11111111-1111-1111-1111-111111111111',
   '22222222-2222-2222-2222-222222222202', 'Разобрать холодильник', 'кухня', 'quest', 25,
   'monthly', null, '12:00', 'review', true)
on conflict (id) do nothing;

-- «Квесты» больше не закреплены за человеком: они попадают в общий котёл, и взять
-- их может кто угодно. «Долг» (своя комната, своя посуда) остаётся личным.
update public.task_templates set assignee_id = null where kind = 'quest';

-- уже созданные на сегодня задачи переводим в общую очередь
update public.assignments a
   set assignee_id = null
 where a.status = 'pending'
   and a.template_id is not null
   and exists (
     select 1 from public.task_templates t
     where t.id = a.template_id and t.assignee_id is null
   );

-- ───────────────────────────── призы ────────────────────────────────────────

insert into public.rewards (id, family_id, title, description, tier, price_coins, stock)
values
  ('44444444-4444-4444-4444-444444444401', '11111111-1111-1111-1111-111111111111',
   'Выбор фильма на вечер', 'Какой фильм смотрим — решаешь ты', 'micro', 40, null),
  ('44444444-4444-4444-4444-444444444402', '11111111-1111-1111-1111-111111111111',
   'Час игр сверх лимита', 'Плюс один час экранного времени', 'micro', 60, null),
  ('44444444-4444-4444-4444-444444444403', '11111111-1111-1111-1111-111111111111',
   'Не мыть посуду один раз', 'Разовая индульгенция', 'micro', 50, null),
  ('44444444-4444-4444-4444-444444444404', '11111111-1111-1111-1111-111111111111',
   'Новая книга', 'Любая книга в пределах разумного', 'medium', 200, null),
  ('44444444-4444-4444-4444-444444444405', '11111111-1111-1111-1111-111111111111',
   'Поход в кино', 'Всем составом, с попкорном', 'medium', 250, null),
  ('44444444-4444-4444-4444-444444444406', '11111111-1111-1111-1111-111111111111',
   'Настольная игра', 'Выбираешь ты, играем вместе', 'global', 400, null)
on conflict (id) do nothing;

-- ───────────────────────────── стартовое приглашение ────────────────────────
-- Код генерируется случайно (в репозитории его нет). Посмотреть:
--   select code from public.invites where used_at is null;

insert into public.invites (code, family_id, member_id, role)
select upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8)),
       '11111111-1111-1111-1111-111111111111',
       '22222222-2222-2222-2222-222222222201',
       'admin'
where not exists (
  select 1 from public.invites
  where family_id = '11111111-1111-1111-1111-111111111111' and used_at is null
);

-- ───────────────────────────── заготовки на сегодня ─────────────────────────
-- Материализуем задачи на сегодня, чтобы после установки не было пустого экрана.

-- Разовая уборка: «долг» больше не помечается как просроченный (см. close_overdue),
-- поэтому старые записи переводим в нейтральное «пропущено».
update public.assignments
   set status = 'skipped'
 where status = 'missed' and (kind = 'duty' or weight = 0);

select public.materialize_daily('11111111-1111-1111-1111-111111111111', null);
