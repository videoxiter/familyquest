export type Role = 'admin' | 'child'

export type TaskStatus = 'pending' | 'submitted' | 'approved' | 'rejected' | 'missed' | 'skipped'

export type Profile = {
  id: string
  display_name: string
  emoji: string
  color: string
  role: Role
  login: string
  birth_date: string | null
  age: number | null
  coins: number
  xp_total: number
  level: { idx: number; name: string; threshold: number }
  next_level: { idx: number; name: string; threshold: number } | null
  streak: number
  streak_best: number
  streak_freezes: number
  badges: number
  open_tasks: number
  today: string
  family: { id: string; name: string; timezone: string; coin_name: string }
}

export type Task = {
  id: string
  title: string
  category: string
  kind: 'duty' | 'quest'
  weight: number
  approval: 'auto' | 'review'
  status: TaskStatus
  due_at: string | null
  due_date: string | null
  coins_awarded: number
  xp_awarded: number
  source: string
  submitted_at: string | null
  decided_at: string | null
  overdue: boolean
  /** Задача лежит в общей очереди: исполнителя ещё нет. */
  in_pool: boolean
  /** Задача закреплена за мной. */
  mine: boolean
}

export type LoginMember = {
  login: string
  display_name: string
  emoji: string
  color: string
  role: Role
}

export type FeedItem = {
  id: number
  kind: string
  payload: Record<string, unknown>
  created_at: string
  actor_name: string | null
  actor_emoji: string | null
  actor_color: string | null
  subject_name: string | null
  reactions: { emoji: string; member: string }[]
}

export type Reward = {
  id: string
  title: string
  description: string | null
  tier: 'micro' | 'medium' | 'global'
  price_coins: number
  stock: number | null
}

export type Redemption = {
  id: string
  status: 'pending' | 'approved' | 'rejected' | 'delivered'
  coins_spent: number
  created_at: string
  title: string
}

export type RewardsBundle = { rewards: Reward[]; redemptions: Redemption[] }

export type LevelRow = { idx: number; name: string; xp_threshold: number }

export type Achievement = {
  code: string
  title: string
  description: string | null
  hidden: boolean
  icon: string
}

export type MemberAchievement = {
  code: string
  progress: number
  unlocked_at: string | null
}

export type LedgerRow = {
  id: number
  coins: number
  xp: number
  kind: string
  note: string | null
  created_at: string
}

export type AdminMember = {
  id: string
  login: string
  display_name: string
  emoji: string
  color: string
  role: Role
  birth_date: string | null
  age: number | null
  coins: number
  xp_total: number
  has_account: boolean
}

export type AdminTaskRow = {
  id: string
  title: string
  category: string
  weight: number
  status: TaskStatus
  due_at: string | null
  approval: 'auto' | 'review'
  /** null — задачу ещё никто не взял (общая очередь). */
  assignee_name: string | null
  assignee_emoji: string
  in_pool: boolean
}

export type AdminQueue = {
  date: string
  submitted: AdminTaskRow[]
  today: AdminTaskRow[]
  members: AdminMember[]
}

export type NewTemplate = {
  title: string
  category: string
  kind: 'duty' | 'quest'
  base_weight: number
  recurrence: 'none' | 'daily' | 'weekly' | 'monthly'
  weekdays: number[] | null
  due_time: string | null
  approval: 'auto' | 'review'
  assignee_id: string
}
