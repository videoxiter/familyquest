import { supabase } from './supabase'
import type {
  Achievement,
  AdminQueue,
  FeedItem,
  LedgerRow,
  LevelRow,
  LoginMember,
  MemberAchievement,
  NewTemplate,
  Profile,
  RewardsBundle,
  Task,
} from './types'

/** Псевдо-домен для входа: Supabase Auth требует email, а семье нужен логин. */
const LOGIN_DOMAIN = 'family.local'

const ERROR_TEXT: [string, string][] = [
  ['invite_not_found', 'Код не подошёл — спроси актуальный у родителя'],
  ['invite_used', 'Этот код уже использован'],
  ['invite_expired', 'Срок действия кода истёк'],
  ['not_member', 'Нет профиля в этой семье'],
  ['forbidden', 'Недостаточно прав'],
  ['not_pending', 'Задача уже не в работе'],
  ['not_awaiting', 'Задача не ждёт решения'],
  ['not_submitted', 'Задача не отправлена на проверку'],
  ['assignment_not_found', 'Задача не найдена'],
  ['already_closed', 'Задача уже закрыта'],
  ['not_enough_coins', 'Не хватает монет'],
  ['out_of_stock', 'Этот приз закончился'],
  ['reward_not_found', 'Приз не найден'],
  ['login_required', 'Нужен логин латиницей'],
  ['bad_role', 'Неизвестная роль'],
  ['Invalid login credentials', 'Неверный логин или код'],
  ['User already registered', 'Такой логин уже занят'],
  ['Password should be at least', 'Код слишком короткий — минимум 6 символов'],
  ['Database error saving new user', 'Код не подошёл или уже использован'],
  ['duplicate key value', 'Такой логин уже существует'],
  ['Failed to fetch', 'Нет связи с сервером — проверь интернет'],
  [
    'Invalid path specified in request URL',
    'Адрес проекта в переменных сборки неверный: нужен только https://xxxx.supabase.co, без /rest/v1',
  ],
  [
    'No API key found',
    'Не задан ключ проекта: добавь переменную VITE_SUPABASE_ANON_KEY со значением anon public',
  ],
  [
    'Invalid API key',
    'Ключ проекта не подошёл: скопируй anon public из Project Settings → API (не service_role)',
  ],
  ['Email not confirmed', 'Включено подтверждение почты: выключи Confirm email в Supabase'],
  ['email_confirmation_required', 'Выключи Confirm email в Supabase → Authentication → Email'],
]

export function prettyError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e)
  for (const [needle, text] of ERROR_TEXT) {
    if (raw.includes(needle)) return text
  }
  return raw
}

export function emailFor(login: string): string {
  return `${login.trim().toLowerCase()}@${LOGIN_DOMAIN}`
}

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw new Error(prettyError(error.message))
  return data as T
}

function ensure<T>(result: { data: T; error: { message: string } | null }): T {
  if (result.error) throw new Error(prettyError(result.error.message))
  return result.data
}

// ───────────────────────────── авторизация ─────────────────────────────────

export async function signIn(login: string, password: string): Promise<void> {
  const { error } = await supabase.auth.signInWithPassword({
    email: emailFor(login),
    password,
  })
  if (error) throw new Error(prettyError(error.message))
}

export async function signUpWithInvite(input: {
  invite: string
  login: string
  password: string
  displayName?: string
}): Promise<void> {
  const login = input.login.trim().toLowerCase()
  const { data, error } = await supabase.auth.signUp({
    email: emailFor(login),
    password: input.password,
    options: {
      data: {
        invite: input.invite.trim().toUpperCase(),
        login,
        display_name: (input.displayName ?? '').trim(),
      },
    },
  })
  if (error) throw new Error(prettyError(error.message))
  if (!data.session) {
    throw new Error(
      'Аккаунт создан, но вход не выполнен. Выключи «Confirm email» в Supabase: Authentication → Sign In / Providers → Email.',
    )
  }
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut()
}

// ───────────────────────────── данные ──────────────────────────────────────

export const loginMembers = () => rpc<LoginMember[]>('login_members')
export const myProfile = () => rpc<Profile | null>('my_profile')
export const myToday = (date: string | null) => rpc<Task[]>('my_today', { p_date: date })
export const familyFeed = (limit = 40) => rpc<FeedItem[]>('family_feed', { p_limit: limit })
export const adminQueue = () => rpc<AdminQueue>('admin_queue')
export const rewardsBundle = () => rpc<RewardsBundle>('my_rewards')

export type CompleteResult = { id: string; status: string; coins: number; xp: number }

export const completeTask = (id: string) => rpc<CompleteResult>('complete_assignment', { p_id: id })
export const approveTask = (id: string) => rpc<CompleteResult>('approve_assignment', { p_id: id })
export const rejectTask = (id: string, reason: string | null) =>
  rpc<{ id: string; status: string }>('reject_assignment', { p_id: id, p_reason: reason })
export const waiveTask = (id: string) => rpc<{ id: string; status: string }>('waive_assignment', { p_id: id })
export const redeemReward = (id: string) => rpc<{ redemption_id: string; coins_spent: number }>('redeem_reward', { p_reward_id: id })
export const materializeToday = () => rpc<number>('materialize_daily', { p_family: null, p_date: null })
export const createInvite = (memberId: string) => rpc<string>('create_invite', { p_member: memberId })
export const createMember = (input: {
  displayName: string
  role: 'admin' | 'child'
  login: string
  birthDate: string | null
}) =>
  rpc<{ member_id: string; login: string; code: string }>('create_member', {
    p_display_name: input.displayName,
    p_role: input.role,
    p_login: input.login,
    p_birth_date: input.birthDate,
  })

export const levels = async (): Promise<LevelRow[]> => {
  const data = ensure(await supabase.from('levels').select('idx, name, xp_threshold').order('idx'))
  return (data ?? []) as LevelRow[]
}

export const achievementsFor = async (memberId: string): Promise<{
  all: Achievement[]
  mine: MemberAchievement[]
}> => {
  const [all, mine] = await Promise.all([
    supabase.from('achievements').select('code, title, description, hidden, icon'),
    supabase.from('member_achievements').select('code, progress, unlocked_at').eq('member_id', memberId),
  ])
  return {
    all: ensure(all) as Achievement[],
    mine: ensure(mine) as MemberAchievement[],
  }
}

export const ledgerFor = async (memberId: string, limit = 25): Promise<LedgerRow[]> =>
  ensure(
    await supabase
      .from('ledger')
      .select('id, coins, xp, kind, note, created_at')
      .eq('member_id', memberId)
      .order('created_at', { ascending: false })
      .limit(limit),
  ) as LedgerRow[]

export const addTemplate = async (template: NewTemplate, familyId: string): Promise<void> => {
  ensure(
    await supabase.from('task_templates').insert({
      family_id: familyId,
      assignee_id: template.assignee_id,
      title: template.title,
      category: template.category,
      kind: template.kind,
      base_weight: template.base_weight,
      recurrence: template.recurrence,
      weekdays: template.weekdays,
      due_time: template.due_time,
      approval: template.approval,
    }),
  )
}

export const setBirthDate = async (memberId: string, birthDate: string | null): Promise<void> => {
  ensure(await supabase.from('members').update({ birth_date: birthDate }).eq('id', memberId))
}

export const addReaction = async (feedId: number, memberId: string, emoji: string): Promise<void> => {
  ensure(await supabase.from('reactions').insert({ feed_id: feedId, member_id: memberId, emoji }))
}

export const removeReaction = async (feedId: number, memberId: string, emoji: string): Promise<void> => {
  ensure(
    await supabase
      .from('reactions')
      .delete()
      .eq('feed_id', feedId)
      .eq('member_id', memberId)
      .eq('emoji', emoji),
  )
}

export const createOneoffAssignment = (input: {
  title: string
  assigneeId: string
  weight: number
  category: string
  dueAt: string | null
  approval: 'auto' | 'review'
}) =>
  rpc<string>('create_oneoff_assignment', {
    p_title: input.title,
    p_assignee: input.assigneeId,
    p_weight: input.weight,
    p_category: input.category,
    p_due_at: input.dueAt,
    p_approval: input.approval,
  })
