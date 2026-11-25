// Проверка миграций на реальном Postgres (PGlite, WASM).
// Supabase-специфику подменяем минимальными заглушками: auth.users, auth.uid(), роли.
// Запуск: npm run test:sql  (по файлам) или npm run test:bundle (готовый apply_all.sql)
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const db = new PGlite()

/** true — проверяем ровно тот файл, который вставляют в Supabase SQL Editor. */
const USE_BUNDLE = process.argv.includes('--bundle') || process.env.FQ_TEST_BUNDLE === '1'

const FAMILY = '11111111-1111-1111-1111-111111111111'
const PAPA = '22222222-2222-2222-2222-222222222201'
const MAMA = '22222222-2222-2222-2222-222222222202'
const ALYOSHA = '22222222-2222-2222-2222-222222222203'
const PAPA_USER = 'aaaaaaaa-0000-0000-0000-000000000001'
const ALYOSHA_USER = 'aaaaaaaa-0000-0000-0000-000000000002'

let failed = 0
function check(name, ok, detail = '') {
  if (!ok) failed++
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
}

async function one(sql, params = []) {
  const res = await db.query(sql, params)
  return res.rows[0]
}

async function apply(file) {
  const raw = readFileSync(join(root, 'supabase', 'migrations', file), 'utf8')
  const sql = raw.replace(/create extension if not exists pgcrypto;/gi, '-- pgcrypto: в Supabase есть')
  await db.exec(sql)
  console.log(`  · применён ${file}`)
}

/** PGlite не умеет расширения — вырезаем только их подключение. */
function stripExtensions(sql) {
  return sql
    .replace(/create extension if not exists pgcrypto;/gi, '-- pgcrypto: в Supabase есть')
    .replace(/create extension if not exists pg_cron;/gi, '-- pg_cron: в Supabase включается отдельно')
}

async function applyAll() {
  if (!USE_BUNDLE) {
    await apply('0001_schema.sql')
    await apply('0002_rls.sql')
    await apply('0003_engine.sql')
    await apply('0005_seed.sql')
    return
  }

  const raw = readFileSync(join(root, 'supabase', 'apply_all.sql'), 'utf8')
  await db.exec(stripExtensions(raw))
  console.log('  · применён supabase/apply_all.sql (тот же файл, что вставляется в Supabase)')
}

try {
  console.log('Готовим окружение Supabase…')
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create role supabase_auth_admin;
    create schema if not exists auth;
    create table auth.users (
      id uuid primary key,
      email text,
      raw_user_meta_data jsonb default '{}'::jsonb,
      created_at timestamptz default now()
    );
    create or replace function auth.uid() returns uuid
      language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
  `)

  console.log('Применяем миграции…')
  await applyAll()

  // ── схема и сид ──────────────────────────────────────────────────────────
  const tables = await one(
    `select count(*)::int as n from information_schema.tables where table_schema = 'public'`,
  )
  check('схема создана', tables.n >= 14, `${tables.n} таблиц`)

  const seed = await one(`
    select (select count(*) from public.members)::int as members,
           (select count(*) from public.task_templates)::int as templates,
           (select count(*) from public.levels)::int as levels,
           (select count(*) from public.rewards)::int as rewards,
           (select count(*) from public.achievements)::int as achievements
  `)
  check(
    'стартовые данные на месте',
    seed.members === 3 && seed.templates >= 10 && seed.levels === 12 && seed.rewards === 6 && seed.achievements === 7,
    `участников ${seed.members}, шаблонов ${seed.templates}, уровней ${seed.levels}, призов ${seed.rewards}`,
  )

  // ── регистрация по инвайту ───────────────────────────────────────────────
  const invite = await one(
    `select code from public.invites where member_id = $1 and used_at is null limit 1`,
    [PAPA],
  )
  check('есть приглашение для папы', Boolean(invite?.code), invite?.code ?? 'нет')

  await db.query(
    `insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`,
    [PAPA_USER, 'papa@family.local', JSON.stringify({ invite: invite.code, login: 'papa' })],
  )
  const linked = await one(`select user_id, role, login from public.members where id = $1`, [PAPA])
  check('триггер привязал аккаунт к карточке', linked.user_id === PAPA_USER, `роль ${linked.role}`)
  check('приглашение помечено использованным', (await one(
    `select used_at from public.invites where code = $1`, [invite.code],
  )).used_at !== null)

  // дальше работаем «как папа»
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [PAPA_USER])

  const profile = await one(`select public.my_profile() as p`)
  check('my_profile возвращает профиль', profile.p?.display_name === 'Папа', `уровень: ${profile.p?.level?.name}`)

  // ── начисление за квест ─────────────────────────────────────────────────
  const quest = await one(
    `select public.create_oneoff_assignment('Тест-квест', $1, 25, 'кухня', now() + interval '2 hours', 'auto') as id`,
    [PAPA],
  )
  check('разовая задача создана', Boolean(quest.id))

  const done = await one(`select public.complete_assignment($1) as r`, [quest.id])
  check('квест закрыт с начислением', done.r.status === 'approved' && done.r.coins === 25, `+${done.r.coins} монет, +${done.r.xp} опыта`)

  const after = await one(`select coins, xp_total from public.members where id = $1`, [PAPA])
  check('баланс участника вырос', after.coins === 25 && after.xp_total === 25)

  const ledger = await one(`select count(*)::int as n, sum(coins)::int as coins from public.ledger`)
  check('журнал содержит одну запись', ledger.n === 1 && ledger.coins === 25)

  let rejectedDouble = false
  try {
    await db.query(`select public.complete_assignment($1)`, [quest.id])
  } catch {
    rejectedDouble = true
  }
  check('повторное закрытие запрещено', rejectedDouble)

  const streak = await one(`select current, last_day from public.streaks where member_id = $1`, [PAPA])
  check('серия началась', streak.current === 1)

  // ── задача «долг» и проверка родителем ──────────────────────────────────
  const duty = await one(
    `select public.create_oneoff_assignment('Своя посуда', $1, 0, 'кухня', null, 'auto') as id`,
    [PAPA],
  )
  const dutyDone = await one(`select public.complete_assignment($1) as r`, [duty.id])
  check('долг закрывается без баллов', dutyDone.r.status === 'approved' && dutyDone.r.coins === 0)

  // приглашаем Алёшу (ребёнок) — на нём проверим одобрение родителем
  const alyoshaInvite = await one(`select public.create_invite($1) as code`, [ALYOSHA])
  await db.query(
    `insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`,
    [ALYOSHA_USER, 'alyosha@family.local', JSON.stringify({ invite: alyoshaInvite.code })],
  )
  const alyoshaLinked = await one(`select user_id from public.members where id = $1`, [ALYOSHA])
  check('второй аккаунт привязан', alyoshaLinked.user_id === ALYOSHA_USER)

  const review = await one(
    `select public.create_oneoff_assignment('Проверяемая', $1, 30, 'уборка', now() + interval '1 hour', 'review') as id`,
    [ALYOSHA],
  )
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [ALYOSHA_USER])
  const submitted = await one(`select public.complete_assignment($1) as r`, [review.id])
  check('задача на проверке не начисляет', submitted.r.status === 'submitted' && submitted.r.coins === 0)

  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [PAPA_USER])
  const approved = await one(`select public.approve_assignment($1) as r`, [review.id])
  check('одобрение начисляет баллы', approved.r.status === 'approved' && approved.r.coins === 30)

  const ids = await one(`select public.my_today() as t`)
  check('my_today отдаёт список', Array.isArray(ids.t), `${ids.t.length} задач`)

  const queue = await one(`select public.admin_queue() as q`)
  check('admin_queue работает', Array.isArray(queue.q?.members) && queue.q.members.length === 3)

  // ── просрочка и cron-функции ────────────────────────────────────────────
  const overdue = await one(
    `select public.create_oneoff_assignment('Просроченная', $1, 10, 'дом', now() - interval '2 hours', 'auto') as id`,
    [PAPA],
  )
  const closed = await one(`select public.close_overdue() as n`)
  const overdueStatus = await one(`select status from public.assignments where id = $1`, [overdue.id])
  check('просрочка закрывается', closed.n >= 1 && overdueStatus.status === 'missed', `закрыто: ${closed.n}`)

  const tomorrow = await one(`select public.materialize_daily(null, current_date + 3) as n`)
  check('материализация на завтра', tomorrow.n > 0, `создано ${tomorrow.n}`)

  const repeat = await one(`select public.materialize_daily(null, current_date + 3) as n`)
  check('повторная материализация не дублирует', repeat.n === 0)

  // ── общая очередь: кто первый взял ──────────────────────────────────────
  const poolTask = await one(
    `select id from public.assignments where assignee_id is null and status = 'pending' limit 1`,
  )
  check('в общей очереди есть свободные задачи', Boolean(poolTask?.id))

  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [PAPA_USER])
  const claimed = await one(`select public.claim_assignment($1) as r`, [poolTask.id])
  check('задачу можно взять из очереди', claimed.r?.mine === true)

  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [ALYOSHA_USER])
  let takenErr = false
  try {
    await db.query(`select public.claim_assignment($1)`, [poolTask.id])
  } catch (e) {
    takenErr = String(e.message).includes('already_taken')
  }
  check('второй человек взять не может', takenErr)

  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [PAPA_USER])
  await db.query(`select public.release_assignment($1)`, [poolTask.id])
  const released = await one(`select assignee_id from public.assignments where id = $1`, [poolTask.id])
  check('отказ возвращает задачу в очередь', released.assignee_id === null)

  const autoTask = await one(
    `select id from public.assignments
      where assignee_id is null and status = 'pending' and approval = 'auto' and kind = 'quest'
      limit 1`,
  )
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [ALYOSHA_USER])
  const autoDone = await one(`select public.complete_assignment($1) as r`, [autoTask.id])
  const autoOwner = await one(`select assignee_id from public.assignments where id = $1`, [autoTask.id])
  check(
    'выполнение свободной задачи закрепляет её за выполнившим',
    autoOwner.assignee_id === ALYOSHA && autoDone.r.status === 'approved',
  )

  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [PAPA_USER])

  // ── призы ───────────────────────────────────────────────────────────────
  const reward = await one(`select id, price_coins from public.rewards order by price_coins limit 1`)
  let notEnough = false
  try {
    const balance = await one(`select coins from public.members where id = $1`, [PAPA])
    if (balance.coins < reward.price_coins) {
      await db.query(`select public.redeem_reward($1)`, [reward.id])
    } else {
      throw new Error('хватает монет')
    }
  } catch (e) {
    notEnough = String(e.message).includes('not_enough_coins')
  }
  check('нельзя купить приз без монет', notEnough)

  await db.query(`update public.members set coins = 500 where id = $1`, [PAPA])
  const redeemed = await one(`select public.redeem_reward($1) as r`, [reward.id])
  const balanceAfter = await one(`select coins from public.members where id = $1`, [PAPA])
  check('обмен списывает монеты', redeemed.r.coins_spent === reward.price_coins && balanceAfter.coins === 500 - reward.price_coins)

  // ── новый участник ──────────────────────────────────────────────────────
  const created = await one(`select public.create_member('Тестовый', 'child', 'testik', '2018-01-01') as r`)
  check('участник создан с кодом', Boolean(created.r?.code) && created.r.login === 'testik')

  // ── RLS: ребёнок не видит чужое и не правит баллы ───────────────────────
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [ALYOSHA_USER])

  const allAssignments = await one(`select count(*)::int as n from public.assignments`)
  const alyoshaTotal = await one(
    `select count(*)::int as n from public.assignments where assignee_id = $1`,
    [ALYOSHA],
  )
  const poolTotal = await one(
    `select count(*)::int as n from public.assignments where assignee_id is null`,
  )
  check(
    'проверка RLS осмысленна (есть чужие задачи)',
    allAssignments.n > alyoshaTotal.n + poolTotal.n,
    `всего ${allAssignments.n}, у Алёши ${alyoshaTotal.n}, в очереди ${poolTotal.n}`,
  )

  await db.query(`set role authenticated`)

  const visible = await one(`select count(*)::int as n from public.assignments`)
  check(
    'RLS: видны свои задачи и общая очередь',
    visible.n === alyoshaTotal.n + poolTotal.n,
    `${visible.n} из ${allAssignments.n}`,
  )

  const hack = await db.query(
    `update public.members set coins = 9999 where id = $1 returning id`,
    [ALYOSHA],
  )
  check('RLS: нельзя поднять себе монеты', hack.rows.length === 0)

  const foreignLedger = await db.query(
    `select * from public.ledger where member_id = $1`,
    [PAPA],
  )
  check('RLS: чужой журнал не виден', foreignLedger.rows.length === 0)

  await db.query(`reset role`)

  // ── итог ────────────────────────────────────────────────────────────────
  console.log('')
  if (failed > 0) {
    console.log(`ПРОВАЛЕНО проверок: ${failed}`)
    process.exit(1)
  }
  console.log('Все проверки пройдены.')
} catch (error) {
  console.error('\nОшибка:', error.message)
  if (error.position) console.error('позиция в SQL:', error.position)
  if (error.detail) console.error('детали:', error.detail)
  process.exit(1)
}
