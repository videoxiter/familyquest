import { useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import {
  addTemplate,
  approveTask,
  createInvite,
  createMember,
  createOneoffAssignment,
  materializeToday,
  prettyError,
  rejectTask,
  setBirthDate,
  waiveTask,
  type CompleteResult,
} from '../lib/api'
import { CATEGORIES, categoryEmoji } from '../lib/categories'
import { dayLabel, timeOf } from '../lib/format'
import { useAction, useAdminQueue } from '../lib/queries'
import type { AdminMember, AdminTaskRow, NewTemplate, Profile } from '../lib/types'
import { Button, Card, Empty, SectionTitle, Spinner } from '../components/ui'
import { StatusBadge } from './Progress'

const inputCls =
  'w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2.5 text-[15px] outline-none focus:border-accent'

type Tab = 'queue' | 'tasks' | 'family'

export default function Admin() {
  const me = useOutletContext<Profile>()
  const isAdmin = me.role === 'admin'
  const queue = useAdminQueue(isAdmin)
  const [tab, setTab] = useState<Tab>('queue')
  const [flash, setFlash] = useState<string | null>(null)

  const approve = useAction<string, CompleteResult>(approveTask)
  const reject = useAction<string, { id: string; status: string }>((id) => rejectTask(id, null))
  const waive = useAction<string, { id: string; status: string }>(waiveTask)
  const materialize = useAction<void, number>(() => materializeToday())

  if (!isAdmin) {
    return <Empty>Раздел доступен родителям.</Empty>
  }

  const say = (text: string) => {
    setFlash(text)
    window.setTimeout(() => setFlash(null), 4000)
  }

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn()
      if (ok) say(ok)
    } catch (e) {
      say(prettyError(e))
    }
  }

  const data = queue.data

  return (
    <div className="space-y-4">
      <div className="flex gap-1.5">
        {(
          [
            ['queue', 'Одобрение'],
            ['tasks', 'Задачи'],
            ['family', 'Семья'],
          ] as [Tab, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={
              'flex-1 rounded-xl px-3 py-2 text-sm transition-colors ' +
              (tab === key ? 'bg-accent text-ink-950 font-semibold' : 'bg-white/5 text-mist-300')
            }
          >
            {label}
          </button>
        ))}
      </div>

      {flash && (
        <div className="animate-pop rounded-xl border border-accent/40 bg-accent-soft px-3 py-2 text-sm text-accent">
          {flash}
        </div>
      )}

      {queue.isLoading && (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      )}

      {data && tab === 'queue' && (
        <section className="space-y-2">
          <SectionTitle action={<span className="text-xs text-mist-500">{data.submitted.length} ждут</span>}>
            На проверку
          </SectionTitle>

          {data.submitted.length === 0 && <Empty>Ничего не ждёт проверки. Хороший знак.</Empty>}

          {data.submitted.map((task) => (
            <Card key={task.id}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span>{task.assignee_emoji}</span>
                    <span className="truncate font-medium">{task.title}</span>
                  </div>
                  <div className="mt-1 text-xs text-mist-500">
                    {task.assignee_name ?? 'исполнитель'} · {task.category} · {task.weight} 🪙
                    {task.due_at ? ` · срок ${timeOf(task.due_at)}` : ''}
                  </div>
                </div>
                <StatusBadge status={task.status} />
              </div>

              <div className="mt-3 flex gap-2">
                <Button
                  className="flex-1"
                  disabled={approve.isPending}
                  onClick={() => void run(() => approve.mutateAsync(task.id), 'Задача закрыта')}
                >
                  Одобрить
                </Button>
                <Button
                  className="flex-1"
                  variant="ghost"
                  disabled={reject.isPending}
                  onClick={() => void run(() => reject.mutateAsync(task.id), 'Возвращено исполнителю')}
                >
                  Вернуть
                </Button>
              </div>
            </Card>
          ))}
        </section>
      )}

      {data && tab === 'tasks' && (
        <>
          <section className="space-y-2">
            <SectionTitle action={<span className="text-xs text-mist-500">{dayLabel(data.date)}</span>}>
              Задачи дня
            </SectionTitle>

            <div className="flex gap-2">
              <Button
                variant="soft"
                className="flex-1"
                disabled={materialize.isPending}
                onClick={() =>
                  void run(async () => {
                    const created = await materialize.mutateAsync()
                    say(
                      created > 0
                        ? `Создано задач: ${created}`
                        : 'Новых задач нет — на сегодня всё уже создано',
                    )
                  })
                }
              >
                Создать задачи на сегодня
              </Button>
            </div>

            {data.today.length === 0 && <Empty>На сегодня задач нет.</Empty>}

            <div className="space-y-1.5">
              {data.today.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  onWaive={() => void run(() => waive.mutateAsync(task.id), 'Задача прощена')}
                  onApprove={() => void run(() => approve.mutateAsync(task.id), 'Задача закрыта')}
                />
              ))}
            </div>
          </section>

          <NewTaskForm
            members={data.members}
            today={data.date}
            familyId={me.family.id}
            onDone={say}
            onMaterialize={() => materialize.mutateAsync()}
          />
        </>
      )}

      {data && tab === 'family' && (
        <FamilyTab members={data.members} onDone={say} />
      )}
    </div>
  )
}

function TaskRow({
  task,
  onWaive,
  onApprove,
}: {
  task: AdminTaskRow
  onWaive: () => void
  onApprove: () => void
}) {
  return (
    <div className="rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm">
            <span className="mr-1">{categoryEmoji(task.category)}</span>
            {task.title}
          </div>
          <div className="text-xs text-mist-500">
            {task.in_pool ? '📥 в общей очереди' : `${task.assignee_emoji} ${task.assignee_name ?? ''}`}
            {' · '}
            {task.weight} 🪙
            {task.due_at ? ` · до ${timeOf(task.due_at)}` : ''}
          </div>
        </div>
        <StatusBadge status={task.status} />
      </div>
      {(task.status === 'pending' || task.status === 'missed' || task.status === 'submitted') && (
        <div className="mt-2 flex gap-2">
          {task.status === 'submitted' && (
            <Button variant="soft" className="flex-1 py-1.5 text-sm" onClick={onApprove}>
              Одобрить
            </Button>
          )}
          <Button variant="ghost" className="flex-1 py-1.5 text-sm" onClick={onWaive}>
            Простить
          </Button>
        </div>
      )}
    </div>
  )
}

function NewTaskForm({
  members,
  today,
  familyId,
  onDone,
  onMaterialize,
}: {
  members: AdminMember[]
  today: string
  familyId: string
  onDone: (text: string) => void
  onMaterialize: () => Promise<number>
}) {
  const add = useAction<NewTemplate, void>((template) => addTemplate(template, familyId))
  const oneoff = useAction<
    { title: string; assigneeId: string; weight: number; category: string; dueAt: string | null; approval: 'auto' | 'review' },
    string
  >(createOneoffAssignment)

  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [assignee, setAssignee] = useState(members[0]?.id ?? '')
  const [weight, setWeight] = useState('10')
  const [category, setCategory] = useState<string>(CATEGORIES[0])
  const [time, setTime] = useState('20:00')
  const [approval, setApproval] = useState<'auto' | 'review'>('auto')
  const [repeat, setRepeat] = useState<'oneoff' | 'daily' | 'weekly'>('oneoff')
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (!title.trim() || !assignee) return
    setBusy(true)
    try {
      const dueAt = time ? new Date(`${today}T${time}:00`).toISOString() : null

      if (repeat === 'oneoff') {
        await oneoff.mutateAsync({
          title: title.trim(),
          assigneeId: assignee,
          weight: Number(weight) || 0,
          category,
          dueAt,
          approval,
        })
        onDone('Разовая задача создана')
      } else {
        await add.mutateAsync({
          title: title.trim(),
          category,
          kind: Number(weight) > 0 ? 'quest' : 'duty',
          base_weight: Number(weight) || 0,
          recurrence: repeat,
          weekdays: repeat === 'weekly' ? [new Date().getDay() === 0 ? 7 : new Date().getDay()] : null,
          due_time: time || null,
          approval,
          assignee_id: assignee,
        })
        const created = await onMaterialize()
        onDone(created > 0 ? `Шаблон создан, задач на сегодня: ${created}` : 'Шаблон создан')
      }

      setTitle('')
      setOpen(false)
    } catch (e) {
      onDone(prettyError(e))
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <Button variant="soft" className="w-full" onClick={() => setOpen(true)}>
        + Новая задача
      </Button>
    )
  }

  return (
    <Card className="space-y-2.5">
      <div className="flex items-center justify-between">
        <h3 className="font-medium">Новая задача</h3>
        <button type="button" className="text-sm text-mist-500" onClick={() => setOpen(false)}>
          отмена
        </button>
      </div>

      <input
        className={inputCls}
        placeholder="Название, например «Помыть полы»"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />

      <div className="grid grid-cols-2 gap-2">
        <select className={inputCls} value={assignee} onChange={(e) => setAssignee(e.target.value)}>
          {members.map((member) => (
            <option key={member.id} value={member.id}>
              {member.display_name}
            </option>
          ))}
        </select>
        <select className={inputCls} value={category} onChange={(e) => setCategory(e.target.value)}>
          {CATEGORIES.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <label className="block">
          <span className="mb-1 block text-xs text-mist-500">Монеты</span>
          <input
            className={inputCls}
            type="number"
            inputMode="numeric"
            min={0}
            max={200}
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-mist-500">Время</span>
          <input className={inputCls} type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-mist-500">Проверка</span>
          <select
            className={inputCls}
            value={approval}
            onChange={(e) => setApproval(e.target.value as 'auto' | 'review')}
          >
            <option value="auto">сама</option>
            <option value="review">родитель</option>
          </select>
        </label>
      </div>

      <label className="block">
        <span className="mb-1 block text-xs text-mist-500">Повтор</span>
        <select
          className={inputCls}
          value={repeat}
          onChange={(e) => setRepeat(e.target.value as 'oneoff' | 'daily' | 'weekly')}
        >
          <option value="oneoff">разово (сегодня)</option>
          <option value="daily">каждый день</option>
          <option value="weekly">раз в неделю</option>
        </select>
      </label>

      <p className="text-xs text-mist-500">
        0 монет = «долг»: задача без награды, но нужная.
      </p>

      <Button className="w-full" onClick={() => void submit()} disabled={busy || !title.trim()}>
        {busy ? 'Создаю…' : 'Создать'}
      </Button>
    </Card>
  )
}

function FamilyTab({ members, onDone }: { members: AdminMember[]; onDone: (text: string) => void }) {
  const invite = useAction<string, string>(createInvite)
  const create = useAction<
    { displayName: string; role: 'admin' | 'child'; login: string; birthDate: string | null },
    { member_id: string; login: string; code: string }
  >(createMember)
  const birth = useAction<{ id: string; date: string | null }, void>((args) =>
    setBirthDate(args.id, args.date),
  )

  const [codes, setCodes] = useState<Record<string, string>>({})
  const [name, setName] = useState('')
  const [login, setLogin] = useState('')
  const [role, setRole] = useState<'admin' | 'child'>('child')
  const [birthDate, setBirthDateValue] = useState('')
  const [busy, setBusy] = useState(false)

  async function addMember() {
    if (!name.trim() || !login.trim()) return
    setBusy(true)
    try {
      const result = await create.mutateAsync({
        displayName: name.trim(),
        role,
        login: login.trim().toLowerCase(),
        birthDate: birthDate || null,
      })
      setCodes((prev) => ({ ...prev, [result.member_id]: result.code }))
      onDone(`Создан ${name.trim()}. Код для входа: ${result.code}`)
      setName('')
      setLogin('')
      setBirthDateValue('')
    } catch (e) {
      onDone(prettyError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <section className="space-y-2">
        <SectionTitle>Участники</SectionTitle>
        {members.map((member) => (
          <Card key={member.id} className="space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate font-medium">
                  {member.emoji} {member.display_name}{' '}
                  <span className="text-xs text-mist-500">{member.role === 'admin' ? 'родитель' : ''}</span>
                </div>
                <div className="text-xs text-mist-500">
                  {member.login} · {member.coins} 🪙 · {member.xp_total} опыта
                  {member.age !== null ? ` · ${member.age} лет` : ''}
                  {member.has_account ? '' : ' · ещё не входил'}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 text-xs text-mist-500">
                Дата рождения
                <input
                  type="date"
                  defaultValue={member.birth_date ?? ''}
                  onChange={(e) =>
                    void birth.mutateAsync({ id: member.id, date: e.target.value || null })
                  }
                  className="rounded-lg border border-white/15 bg-white/5 px-2 py-1 text-xs text-mist-100 outline-none focus:border-accent"
                />
              </label>

              <Button
                variant="ghost"
                className="px-2 py-1 text-xs"
                disabled={invite.isPending}
                onClick={() =>
                  void (async () => {
                    try {
                      const code = await invite.mutateAsync(member.id)
                      setCodes((prev) => ({ ...prev, [member.id]: code }))
                      onDone(`Код для ${member.display_name}: ${code}`)
                    } catch (e) {
                      onDone(prettyError(e))
                    }
                  })()
                }
              >
                Код входа
              </Button>

              {codes[member.id] && (
                <span className="rounded-lg bg-accent-soft px-2 py-1 font-mono text-xs tracking-wider text-accent">
                  {codes[member.id]}
                </span>
              )}
            </div>
          </Card>
        ))}
      </section>

      <section className="space-y-2">
        <SectionTitle>Добавить участника</SectionTitle>
        <Card className="space-y-2">
          <input className={inputCls} placeholder="Имя" value={name} onChange={(e) => setName(e.target.value)} />
          <input
            className={inputCls}
            placeholder="Логин латиницей (papa, masha)"
            value={login}
            onChange={(e) => setLogin(e.target.value.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase())}
          />
          <div className="grid grid-cols-2 gap-2">
            <select className={inputCls} value={role} onChange={(e) => setRole(e.target.value as 'admin' | 'child')}>
              <option value="child">ребёнок</option>
              <option value="admin">родитель</option>
            </select>
            <input
              className={inputCls}
              type="date"
              value={birthDate}
              onChange={(e) => setBirthDateValue(e.target.value)}
            />
          </div>
          <Button className="w-full" onClick={() => void addMember()} disabled={busy || !name || !login}>
            {busy ? 'Создаю…' : 'Создать и получить код'}
          </Button>
          <p className="text-xs text-mist-500">
            Код входа показывается один раз — передай его лично. Войти можно по ссылке «Присоединиться по коду».
          </p>
        </Card>
      </section>
    </div>
  )
}
