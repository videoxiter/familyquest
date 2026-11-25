import { useState, type FormEvent } from 'react'
import { signIn, signUpWithInvite, prettyError } from '../lib/api'
import { useLoginMembers } from '../lib/queries'
import type { LoginMember } from '../lib/types'
import { Art } from '../components/Art'
import { Avatar, Button, Card, ErrorBanner, Spinner } from '../components/ui'

type Mode = 'pick' | 'password' | 'join'

export default function Login() {
  const members = useLoginMembers()
  const [mode, setMode] = useState<Mode>('pick')
  const [selected, setSelected] = useState<LoginMember | null>(null)
  const [password, setPassword] = useState('')
  const [invite, setInvite] = useState('')
  const [login, setLogin] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reset = () => {
    setError(null)
    setPassword('')
    setBusy(false)
  }

  const choose = (member: LoginMember) => {
    setSelected(member)
    setMode('password')
    reset()
  }

  async function submitPassword(e: FormEvent) {
    e.preventDefault()
    if (!selected) return
    setBusy(true)
    setError(null)
    try {
      await signIn(selected.login, password)
    } catch (err) {
      setError(prettyError(err))
      setBusy(false)
    }
  }

  async function submitJoin(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await signUpWithInvite({ invite, login, password, displayName: name })
    } catch (err) {
      setError(prettyError(err))
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 py-10">
      <div className="mb-8">
        <Art src="./art/hero.png" alt="" className="mb-5 w-full rounded-3xl object-contain" />
        <h1 className="text-3xl font-bold tracking-tight">FamilyQuest</h1>
        <p className="mt-1 text-mist-500">Семейные дела, уровни и призы</p>
      </div>

      {mode === 'pick' && (
        <>
          <SectionLabel>Кто ты?</SectionLabel>
          {members.isLoading && (
            <div className="flex justify-center py-8">
              <Spinner />
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            {(members.data ?? []).map((member) => (
              <button
                key={member.login}
                type="button"
                onClick={() => choose(member)}
                className="flex flex-col items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-5 transition-colors hover:bg-white/[0.08]"
              >
                <Avatar emoji={member.emoji} color={member.color} size="lg" />
                <span className="font-medium">{member.display_name}</span>
                {member.role === 'admin' && <span className="text-xs text-mist-500">родитель</span>}
              </button>
            ))}
          </div>

          {members.data?.length === 0 && (
            <Card className="mt-2">
              <p className="text-sm text-mist-300">
                Пока никто не зарегистрирован. Первый вход — по коду приглашения.
              </p>
            </Card>
          )}

          <div className="mt-6 text-center">
            <button
              type="button"
              onClick={() => {
                setMode('join')
                reset()
              }}
              className="text-sm text-accent underline-offset-4 hover:underline"
            >
              Присоединиться по коду
            </button>
          </div>
        </>
      )}

      {mode === 'password' && selected && (
        <form onSubmit={submitPassword} className="space-y-4">
          <div className="flex items-center gap-3">
            <Avatar emoji={selected.emoji} color={selected.color} />
            <div>
              <div className="font-medium">{selected.display_name}</div>
              <div className="text-sm text-mist-500">введи свой код</div>
            </div>
          </div>

          <input
            type="password"
            inputMode="text"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Код или пароль"
            className="w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-base outline-none focus:border-accent"
          />

          <ErrorBanner message={error} />

          <Button type="submit" className="w-full" disabled={busy || password.length < 4}>
            {busy ? 'Вхожу…' : 'Войти'}
          </Button>

          <button
            type="button"
            onClick={() => {
              setMode('pick')
              reset()
            }}
            className="w-full text-sm text-mist-500"
          >
            Это не я
          </button>
        </form>
      )}

      {mode === 'join' && (
        <form onSubmit={submitJoin} className="space-y-3">
          <p className="text-sm text-mist-300">
            Нужен код приглашения — его выдаёт родитель в админке.
          </p>

          <Field label="Код приглашения">
            <input
              value={invite}
              onChange={(e) => setInvite(e.target.value.toUpperCase())}
              placeholder="НАПРИМЕР 3F9A2C1B"
              autoCapitalize="characters"
              className="w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3 tracking-wider outline-none focus:border-accent"
            />
          </Field>

          <Field label="Логин (латиницей)">
            <input
              value={login}
              onChange={(e) => setLogin(e.target.value.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase())}
              placeholder="alyosha"
              autoCapitalize="none"
              className="w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3 outline-none focus:border-accent"
            />
          </Field>

          <Field label="Имя (если карточки ещё нет)">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Алёша"
              className="w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3 outline-none focus:border-accent"
            />
          </Field>

          <Field label="Код/пароль (от 6 символов)">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="например 246810"
              className="w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3 outline-none focus:border-accent"
            />
          </Field>

          <ErrorBanner message={error} />

          <Button
            type="submit"
            className="w-full"
            disabled={busy || !invite || !login || password.length < 6}
          >
            {busy ? 'Создаю…' : 'Присоединиться'}
          </Button>

          <button
            type="button"
            onClick={() => {
              setMode('pick')
              reset()
            }}
            className="w-full text-sm text-mist-500"
          >
            Назад
          </button>
        </form>
      )}
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="mb-3 text-sm font-semibold tracking-wide text-mist-500 uppercase">{children}</div>
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-mist-500">{label}</span>
      {children}
    </label>
  )
}
