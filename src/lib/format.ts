export function plural(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(n) % 100
  const last = abs % 10
  if (abs > 10 && abs < 20) return many
  if (last === 1) return one
  if (last >= 2 && last <= 4) return few
  return many
}

export function timeOf(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}

export function dayLabel(isoDate: string | null): string {
  if (!isoDate) return 'без срока'
  const d = new Date(`${isoDate}T00:00:00`)
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
}

export function relative(iso: string): string {
  const then = new Date(iso).getTime()
  const now = Date.now()
  const diff = Math.max(0, Math.round((now - then) / 1000))
  if (diff < 60) return 'только что'
  const mins = Math.floor(diff / 60)
  if (mins < 60) return `${mins} ${plural(mins, 'минуту', 'минуты', 'минут')} назад`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} ${plural(hours, 'час', 'часа', 'часов')} назад`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'вчера'
  if (days < 7) return `${days} ${plural(days, 'день', 'дня', 'дней')} назад`
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
}

/** Расстояние до дедлайна словами: «через 2 часа», «просрочено на 15 минут». */
export function deadlineHint(iso: string | null): string | null {
  if (!iso) return null
  const due = new Date(iso).getTime()
  const diff = due - Date.now()
  const abs = Math.abs(diff)
  const mins = Math.round(abs / 60000)
  const hours = Math.round(abs / 3600000)
  const parts = mins < 60
    ? `${mins} ${plural(mins, 'минуту', 'минуты', 'минут')}`
    : `${hours} ${plural(hours, 'час', 'часа', 'часов')}`
  return diff < 0 ? `срок истёк ${parts} назад` : `осталось ${parts}`
}

const FEED_KIND_TEXT: Record<string, (p: Record<string, unknown>) => string> = {
  task_done: (p) => `выполнил «${p.title}» · +${p.coins} монет, +${p.xp} опыта`,
  task_late: (p) => `закрыл «${p.title}» с опозданием — без баллов`,
  task_submitted: (p) => `отправил «${p.title}» на проверку`,
  task_rejected: (p) => `задача «${p.title}» возвращена${p.reason ? `: ${p.reason}` : ''}`,
  task_missed: (p) => `пропустил «${p.title}» — срок истёк`,
  task_waived: (p) => `простили «${p.title}»`,
  task_claimed: (p) => `взял «${p.title}» из общей очереди`,
  task_released: (p) => `вернул «${p.title}» в общую очередь`,
  achievement: (p) => `получил значок ${p.icon} «${p.title}»`,
  member_joined: () => 'присоединился к семье',
  reward_redeemed: (p) => `обменял ${p.coins} монет на «${p.reward}»`,
}

export function feedText(kind: string, payload: Record<string, unknown>): string {
  const fn = FEED_KIND_TEXT[kind]
  return fn ? fn(payload) : 'что-то произошло'
}
