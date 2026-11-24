import { useOutletContext } from 'react-router-dom'
import { signOut } from '../lib/api'
import { relative } from '../lib/format'
import { useAchievements, useLedger } from '../lib/queries'
import type { Profile } from '../lib/types'
import { Badge, Button, Card, Empty, ProgressBar, SectionTitle, Spinner } from '../components/ui'

export default function Progress() {
  const me = useOutletContext<Profile>()
  const achievements = useAchievements(me.id)
  const ledger = useLedger(me.id)

  const nextThreshold = me.next_level?.threshold ?? me.level.threshold
  const span = Math.max(1, nextThreshold - me.level.threshold)

  const mineMap = new Map(
    (achievements.data?.mine ?? []).map((item) => [item.code, item] as const),
  )

  const badges = (achievements.data?.all ?? [])
    .map((achievement) => {
      const mine = mineMap.get(achievement.code)
      return {
        ...achievement,
        unlocked: Boolean(mine?.unlocked_at),
        progress: mine?.progress ?? 0,
      }
    })
    .filter((achievement) => !achievement.hidden || achievement.unlocked)
    .sort((a, b) => Number(b.unlocked) - Number(a.unlocked))

  return (
    <div className="space-y-5">
      <Card>
        <div className="flex items-center gap-3">
          <span
            className="flex h-14 w-14 items-center justify-center rounded-2xl text-3xl"
            style={{ backgroundColor: `${me.color}26` }}
          >
            {me.emoji}
          </span>
          <div className="min-w-0">
            <div className="text-lg font-semibold">{me.display_name}</div>
            <div className="text-sm text-mist-500">
              {me.role === 'admin' ? 'родитель' : 'участник'}
              {me.age !== null ? ` · ${me.age} лет` : ''}
            </div>
          </div>
        </div>

        <div className="mt-4">
          <div className="mb-1.5 flex items-baseline justify-between text-sm">
            <span className="font-medium text-accent">
              {me.level.name} · {me.level.idx} ур.
            </span>
            <span className="text-mist-500">
              {me.next_level
                ? `${me.xp_total} / ${me.next_level.threshold} опыта`
                : `${me.xp_total} опыта`}
            </span>
          </div>
          <ProgressBar value={me.xp_total - me.level.threshold} max={span} />
          {me.next_level && (
            <p className="mt-1.5 text-xs text-mist-500">
              до «{me.next_level.name}» — {me.next_level.threshold - me.xp_total} опыта
            </p>
          )}
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          <Stat label="монеты" value={`${me.coins} 🪙`} />
          <Stat label="серия" value={`${me.streak} 🔥`} />
          <Stat label="лучшая" value={`${me.streak_best}`} />
        </div>
      </Card>

      <section>
        <SectionTitle>Значки</SectionTitle>
        {achievements.isLoading && (
          <div className="flex justify-center py-6">
            <Spinner />
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          {badges.map((badge) => (
            <Card
              key={badge.code}
              className={badge.unlocked ? 'border-accent/30 bg-accent-soft/40' : 'opacity-60'}
            >
              <div className="flex items-start gap-2">
                <span className="text-2xl">{badge.unlocked ? badge.icon : '🔒'}</span>
                <div className="min-w-0">
                  <div className="text-sm font-medium leading-tight">{badge.title}</div>
                  <div className="mt-0.5 text-xs text-mist-500">
                    {badge.unlocked ? badge.description : `прогресс: ${badge.progress}`}
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </section>

      <section>
        <SectionTitle>История баллов</SectionTitle>
        {ledger.isLoading && (
          <div className="flex justify-center py-6">
            <Spinner />
          </div>
        )}
        {ledger.data?.length === 0 && <Empty>Пока пусто. Первая выполненная задача появится здесь.</Empty>}
        <div className="space-y-1.5">
          {(ledger.data ?? []).map((row) => (
            <div
              key={row.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2"
            >
              <div className="min-w-0">
                <div className="truncate text-sm">{row.note ?? row.kind}</div>
                <div className="text-xs text-mist-500">{relative(row.created_at)}</div>
              </div>
              <div className="shrink-0 text-right text-sm">
                {row.coins !== 0 && (
                  <div className={row.coins > 0 ? 'font-medium text-accent' : 'text-mist-300'}>
                    {row.coins > 0 ? '+' : ''}
                    {row.coins} 🪙
                  </div>
                )}
                {row.xp !== 0 && <div className="text-xs text-mist-500">+{row.xp} опыта</div>}
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="pt-2">
        <Button variant="ghost" className="w-full" onClick={() => void signOut()}>
          Выйти из аккаунта
        </Button>
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white/5 px-2 py-2">
      <div className="text-sm font-semibold">{value}</div>
      <div className="text-[11px] text-mist-500">{label}</div>
    </div>
  )
}

// Используется в админке: badge-хелпер оставлен здесь, чтобы не дублировать стили.
export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { tone: 'default' | 'muted' | 'accent' | 'success'; text: string }> = {
    pending: { tone: 'default', text: 'в работе' },
    submitted: { tone: 'accent', text: 'на проверке' },
    approved: { tone: 'success', text: 'закрыто' },
    rejected: { tone: 'muted', text: 'возвращено' },
    missed: { tone: 'muted', text: 'срок истёк' },
    skipped: { tone: 'muted', text: 'пропущено' },
  }
  const item = map[status] ?? { tone: 'default' as const, text: status }
  return <Badge tone={item.tone}>{item.text}</Badge>
}
