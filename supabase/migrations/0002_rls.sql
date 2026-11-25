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
