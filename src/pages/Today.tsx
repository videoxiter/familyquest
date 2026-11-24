import { useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { completeTask, prettyError, type CompleteResult } from '../lib/api'
import { categoryEmoji } from '../lib/categories'
import { deadlineHint, timeOf } from '../lib/format'
import { useAction, useToday } from '../lib/queries'
import type { Profile, Task } from '../lib/types'
import { Badge, Button, Card, Empty, ProgressBar, SectionTitle, Spinner } from '../components/ui'

export default function Today() {
  const me = useOutletContext<Profile>()
  const today = useToday()
  const complete = useAction<string, CompleteResult>(completeTask)
  const [flash, setFlash] = useState<string | null>(null)

  const tasks = today.data ?? []
  const open = tasks.filter((t) => t.status === 'pending')
  const done = tasks.filter((t) => t.status !== 'pending')

  const nextThreshold = me.next_level?.threshold ?? me.level.threshold
  const span = Math.max(1, nextThreshold - me.level.threshold)
  const progress = me.xp_total - me.level.threshold

  async function onComplete(task: Task) {
    try {
      const result = await complete.mutateAsync(task.id)
      setFlash(
        result.status === 'approved'
          ? result.coins > 0
            ? `«${task.title}» · +${result.coins} 🪙 · +${result.xp} опыта`
            : `«${task.title}» закрыто · без баллов`
          : `«${task.title}» отправлено на проверку`,
      )
      window.setTimeout(() => setFlash(null), 3200)
    } catch (e) {
      setFlash(prettyError(e))
      window.setTimeout(() => setFlash(null), 4000)
    }
  }

  return (
    <div className="space-y-5">
      <Card className="animate-pop">
        <div className="mb-2 flex items-baseline justify-between">
          <span className="text-sm text-mist-500">
            {me.level.name} · {me.level.idx} уровень
          </span>
          <span className="text-xs text-mist-500">
            {me.next_level ? `до «${me.next_level.name}» ${nextThreshold - me.xp_total} опыта` : 'максимум'}
          </span>
        </div>
        <ProgressBar value={progress} max={span} />
        <div className="mt-3 flex justify-between text-xs text-mist-500">
          <span>{me.xp_total} опыта</span>
          <span>
            {me.coins} 🪙 · 🔥 {me.streak} · 🏅 {me.badges}
          </span>
        </div>
      </Card>

      {flash && (
        <div className="animate-pop rounded-xl border border-accent/40 bg-accent-soft px-3 py-2 text-sm text-accent">
          {flash}
        </div>
      )}

      <section>
        <SectionTitle action={<span className="text-xs text-mist-500">{open.length} в работе</span>}>
          На сегодня
        </SectionTitle>

        {today.isLoading && (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        )}

        {!today.isLoading && open.length === 0 && (
          <Empty>На сегодня всё закрыто. Можно выдохнуть — или заглянуть в призы.</Empty>
        )}

        <div className="space-y-2">
          {open.map((task) => (
            <TaskCard key={task.id} task={task} onComplete={() => void onComplete(task)} busy={complete.isPending} />
          ))}
        </div>
      </section>

      {done.length > 0 && (
        <section>
          <SectionTitle>Закрытые</SectionTitle>
          <div className="space-y-2">
            {done.map((task) => (
              <TaskCard key={task.id} task={task} onComplete={() => undefined} busy={false} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

const STATUS_LABEL: Record<string, string> = {
  submitted: 'на проверке',
  approved: 'закрыто',
  rejected: 'возвращено',
  missed: 'срок истёк',
  skipped: 'пропущено',
}

function TaskCard({ task, onComplete, busy }: { task: Task; onComplete: () => void; busy: boolean }) {
  const isDuty = task.kind === 'duty' || task.weight === 0
  const hint = task.status === 'pending' ? deadlineHint(task.due_at) : null

  return (
    <Card className={task.status === 'pending' ? 'p-3.5' : 'p-3.5 opacity-70'}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 text-xl">{categoryEmoji(task.category)}</span>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className={task.status === 'approved' && !isDuty ? 'font-medium' : 'font-medium'}>
              {task.title}
            </h3>
            {isDuty ? (
              <Badge tone="muted">долг</Badge>
            ) : (
              <span className="shrink-0 text-sm font-semibold text-accent">{task.weight} 🪙</span>
            )}
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-mist-500">
            <span>{task.category}</span>
            {task.due_at && <span>· до {timeOf(task.due_at)}</span>}
            {hint && <span>· {hint}</span>}
            {task.status !== 'pending' && (
              <span className="text-mist-300">· {STATUS_LABEL[task.status] ?? task.status}</span>
            )}
            {task.status === 'approved' && task.coins_awarded > 0 && (
              <span className="text-emerald-300">+{task.coins_awarded} 🪙</span>
            )}
          </div>

          {task.status === 'pending' && (
            <Button
              className="mt-2.5 w-full"
              variant={isDuty ? 'soft' : 'primary'}
              onClick={onComplete}
              disabled={busy}
            >
              {task.approval === 'review' ? 'Сделал — на проверку' : 'Выполнил'}
            </Button>
          )}
        </div>
      </div>
    </Card>
  )
}
