import { useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import {
  claimTask,
  completeTask,
  prettyError,
  releaseTask,
  type CompleteResult,
} from '../lib/api'
import { categoryEmoji } from '../lib/categories'
import { deadlineHint, timeOf } from '../lib/format'
import { useAction, useToday } from '../lib/queries'
import type { Profile, Task } from '../lib/types'
import { Badge, Button, Card, Empty, ProgressBar, SectionTitle, Spinner } from '../components/ui'

export default function Today() {
  const me = useOutletContext<Profile>()
  const today = useToday()
  const complete = useAction<string, CompleteResult>(completeTask)
  const claim = useAction<string, { id: string; status: string; mine: boolean }>(claimTask)
  const release = useAction<string, { id: string; status: string; pool: boolean }>(releaseTask)
  const [flash, setFlash] = useState<string | null>(null)

  const tasks = today.data ?? []
  const mineOpen = tasks.filter(
    (t) => !t.in_pool && (t.status === 'pending' || t.status === 'submitted'),
  )
  const pool = tasks.filter((t) => t.in_pool)
  const done = tasks.filter(
    (t) => !t.in_pool && t.status !== 'pending' && t.status !== 'submitted',
  )

  const nextThreshold = me.next_level?.threshold ?? me.level.threshold
  const span = Math.max(1, nextThreshold - me.level.threshold)
  const progress = me.xp_total - me.level.threshold

  function say(text: string, ms = 3400) {
    setFlash(text)
    window.setTimeout(() => setFlash(null), ms)
  }

  async function run(action: () => Promise<unknown>, ok?: string) {
    try {
      await action()
      if (ok) say(ok)
    } catch (e) {
      say(prettyError(e), 4500)
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
        <SectionTitle action={<span className="text-xs text-mist-500">{mineOpen.length} у тебя</span>}>
          Мои задачи
        </SectionTitle>

        {today.isLoading && (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        )}

        {!today.isLoading && mineOpen.length === 0 && (
          <Empty>
            {tasks.length === 0
              ? 'На сегодня задач нет. Родитель добавит их во вкладке «Админ» → «Задачи» → «+ Новая задача».'
              : pool.length > 0
                ? 'Пока ничего не взято. Выбери задачу из общей очереди ниже — кто первый взял, тот и выполняет.'
                : 'Все дела на сегодня сделаны.'}
          </Empty>
        )}

        <div className="space-y-2">
          {mineOpen.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              onComplete={() =>
                void run(async () => {
                  const result = await complete.mutateAsync(task.id)
                  say(
                    result.status === 'approved'
                      ? result.coins > 0
                        ? `«${task.title}» · +${result.coins} 🪙 · +${result.xp} опыта`
                        : `«${task.title}» закрыто · без баллов`
                      : `«${task.title}» отправлено на проверку`,
                  )
                })
              }
              onRelease={() =>
                void run(() => release.mutateAsync(task.id), `«${task.title}» вернулась в общую очередь`)
              }
              busy={complete.isPending || release.isPending}
            />
          ))}
        </div>
      </section>

      <section>
        <SectionTitle action={<span className="text-xs text-mist-500">{pool.length} свободно</span>}>
          Общая очередь
        </SectionTitle>

        {!today.isLoading && pool.length === 0 && (
          <Empty>Свободных задач нет — всё разобрали.</Empty>
        )}

        <div className="space-y-2">
          {pool.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              onClaim={() => void run(() => claim.mutateAsync(task.id), `Взял «${task.title}»`)}
              busy={claim.isPending}
            />
          ))}
        </div>
      </section>

      {done.length > 0 && (
        <section>
          <SectionTitle>Завершённые</SectionTitle>
          <div className="space-y-2">
            {done.map((task) => (
              <TaskCard key={task.id} task={task} busy={false} />
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

function TaskCard({
  task,
  onComplete,
  onClaim,
  onRelease,
  busy,
}: {
  task: Task
  onComplete?: () => void
  onClaim?: () => void
  onRelease?: () => void
  busy: boolean
}) {
  const isDuty = task.kind === 'duty' || task.weight === 0
  const hint = task.status === 'pending' ? deadlineHint(task.due_at) : null

  return (
    <Card className={task.status === 'pending' ? 'p-3.5' : 'p-3.5 opacity-70'}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 text-xl">{categoryEmoji(task.category)}</span>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-medium">{task.title}</h3>
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
            {task.in_pool && <span>· в очереди</span>}
            {task.status !== 'pending' && (
              <span className="text-mist-300">· {STATUS_LABEL[task.status] ?? task.status}</span>
            )}
            {task.status === 'approved' && task.coins_awarded > 0 && (
              <span className="text-emerald-300">+{task.coins_awarded} 🪙</span>
            )}
          </div>

          {task.status === 'pending' && onClaim && (
            <Button className="mt-2.5 w-full" onClick={onClaim} disabled={busy}>
              Взять
            </Button>
          )}

          {task.status === 'pending' && onComplete && (
            <>
              <Button
                className="mt-2.5 w-full"
                variant={isDuty ? 'soft' : 'primary'}
                onClick={onComplete}
                disabled={busy}
              >
                {task.approval === 'review' ? 'Сделал — на проверку' : 'Выполнил'}
              </Button>
              {onRelease && (
                <button
                  type="button"
                  onClick={onRelease}
                  className="mt-1.5 w-full text-center text-xs text-mist-500 hover:text-mist-300"
                >
                  Отказаться и вернуть в очередь
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </Card>
  )
}
