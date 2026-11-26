-- FamilyQuest · 0006 — web push: подписки устройств, журнал отправок, рассылка
--
-- Как работает:
--   1. клиент подписывается на push и сохраняет endpoint через RPC push_subscribe();
--   2. pg_cron каждые 5 минут вызывает push_tick();
--   3. push_tick находит задачи с дедлайном в ближайший час, помечает их в push_log
--      (чтобы не повторяться) и отдаёт список в Edge Function через pg_net;
--   4. функция-отправитель (supabase/functions/push) рассылает уведомления.

create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null references public.members(id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists push_subs_member_idx on public.push_subscriptions (member_id);

-- Что уже отправляли: защита от повторов при каждом запуске cron.
create table if not exists public.push_log (
  id          bigserial primary key,
  member_id   uuid not null references public.members(id) on delete cascade,
  dedupe_key  text not null,
  created_at  timestamptz not null default now(),
  unique (member_id, dedupe_key)
);

alter table public.push_subscriptions enable row level security;
alter table public.push_log enable row level security;

-- Клиент не читает таблицы напрямую: только через функции ниже.
revoke all on public.push_subscriptions from anon, authenticated;
revoke all on public.push_log from anon, authenticated;

-- ───────────────────────────── подписка устройства ──────────────────────────

create or replace function public.push_subscribe(
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_agent text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := public.current_member_id();
begin
  if v_me is null then raise exception 'not_member'; end if;
  if coalesce(btrim(p_endpoint), '') = '' then raise exception 'bad_endpoint'; end if;

  insert into public.push_subscriptions (member_id, endpoint, p256dh, auth, user_agent)
  values (v_me, p_endpoint, p_p256dh, p_auth, p_agent)
  on conflict (endpoint) do update
    set member_id = v_me,
        p256dh = excluded.p256dh,
        auth = excluded.auth,
        user_agent = excluded.user_agent,
        updated_at = now();

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.push_unsubscribe(p_endpoint text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := public.current_member_id();
begin
  if v_me is null then raise exception 'not_member'; end if;

  delete from public.push_subscriptions
   where endpoint = p_endpoint and member_id = v_me;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.my_push_state()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me uuid := public.current_member_id();
  v_count int := 0;
begin
  if v_me is null then return jsonb_build_object('count', 0); end if;

  select count(*) into v_count
  from public.push_subscriptions where member_id = v_me;

  return jsonb_build_object('count', v_count);
end;
$$;

-- ───────────────────────────── рассылка ─────────────────────────────────────

-- Адрес функции и общий секрет лежат в приватной app_settings:
--   insert into public.app_settings (key, value)
--   values ('push_function', jsonb_build_object('url', '...', 'secret', '...'));
create or replace function public.push_tick()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text;
  v_secret text;
  v_tz text;
  v_items jsonb := '[]'::jsonb;
  v_cleaned int := 0;
begin
  select value ->> 'url', value ->> 'secret'
    into v_url, v_secret
  from public.app_settings where key = 'push_function';

  if coalesce(v_url, '') = '' then
    return jsonb_build_object('skipped', true, 'reason', 'push_function не настроен');
  end if;

  select timezone into v_tz from public.families order by created_at limit 1;
  v_tz := coalesce(v_tz, 'Europe/Moscow');

  with candidates as (
    select a.id, a.assignee_id, a.title, a.due_at
    from public.assignments a
    where a.status = 'pending'
      and a.assignee_id is not null
      and a.due_at is not null
      and a.due_at between now() and now() + interval '60 minutes'
      and not exists (
        select 1 from public.push_log l
        where l.member_id = a.assignee_id
          and l.dedupe_key = 'due:' || a.id::text
      )
  ), logged as (
    insert into public.push_log (member_id, dedupe_key)
    select c.assignee_id, 'due:' || c.id::text from candidates c
    on conflict do nothing
    returning member_id, dedupe_key
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'member_id', c.assignee_id,
           'title', 'Скоро дедлайн',
           'body', c.title || ' — до ' || to_char(c.due_at at time zone v_tz, 'HH24:MI'),
           'url', './#/today'
         )), '[]'::jsonb)
    into v_items
  from candidates c
  join logged l on l.dedupe_key = 'due:' || c.id::text;

  delete from public.push_log where created_at < now() - interval '14 days';
  get diagnostics v_cleaned = row_count;

  if v_items = '[]'::jsonb then
    return jsonb_build_object('sent', 0, 'cleaned', v_cleaned);
  end if;

  perform net.http_post(
    url := v_url,
    body := jsonb_build_object('items', v_items),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-push-secret', v_secret
    ),
    timeout_milliseconds := 15000
  );

  return jsonb_build_object('sent', jsonb_array_length(v_items), 'cleaned', v_cleaned);
exception
  when undefined_function then
    return jsonb_build_object('error', 'pg_net не включён');
  when others then
    return jsonb_build_object('error', sqlerrm);
end;
$$;

-- Ручной тест: отправить уведомление себе (или всем, если null).
create or replace function public.push_test(p_member uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text;
  v_secret text;
  v_items jsonb;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;

  select value ->> 'url', value ->> 'secret'
    into v_url, v_secret
  from public.app_settings where key = 'push_function';

  if coalesce(v_url, '') = '' then
    return jsonb_build_object('error', 'push_function не настроен');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'member_id', m.id,
           'title', 'FamilyQuest',
           'body', 'Проверка уведомлений — всё работает.',
           'url', './#/today'
         )), '[]'::jsonb)
    into v_items
  from public.members m
  where m.deleted_at is null
    and (p_member is null or m.id = p_member);

  perform net.http_post(
    url := v_url,
    body := jsonb_build_object('items', v_items),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', v_secret),
    timeout_milliseconds := 15000
  );

  return jsonb_build_object('sent', jsonb_array_length(v_items));
end;
$$;

-- ───────────────────────────── права ────────────────────────────────────────

do $$
begin
  execute 'revoke all on function public.push_subscribe(text, text, text, text) from public, anon';
  execute 'grant execute on function public.push_subscribe(text, text, text, text) to authenticated';
  execute 'revoke all on function public.push_unsubscribe(text) from public, anon';
  execute 'grant execute on function public.push_unsubscribe(text) to authenticated';
  execute 'revoke all on function public.my_push_state() from public, anon';
  execute 'grant execute on function public.my_push_state() to authenticated';
  execute 'revoke all on function public.push_test(uuid) from public, anon';
  execute 'grant execute on function public.push_test(uuid) to authenticated';
  -- push_tick вызывает только планировщик
  execute 'revoke all on function public.push_tick() from public, anon, authenticated';
end;
$$;

-- ───────────────────────────── расписание ───────────────────────────────────

do $$
declare
  j bigint;
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    for j in select jobid from cron.job where jobname = 'fq-push-tick'
    loop
      perform cron.unschedule(j);
    end loop;

    perform cron.schedule('fq-push-tick', '*/5 * * * *', $cron$ select public.push_tick(); $cron$);
  else
    raise notice 'pg_cron не установлен — push_tick придётся вызывать вручную или извне';
  end if;
exception
  when others then
    raise notice 'расписание push не создано: %', sqlerrm;
end;
$$;
