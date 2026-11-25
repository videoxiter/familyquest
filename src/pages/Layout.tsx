import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import clsx from 'clsx'
import { signOut } from '../lib/api'
import { playSound, playVoice } from '../lib/audio'
import { useProfile } from '../lib/queries'
import { Avatar, Button, Spinner } from '../components/ui'
import { LevelUp } from '../components/LevelUp'

export default function Layout() {
  const profile = useProfile()
  const [celebrate, setCelebrate] = useState<{ idx: number; name: string } | null>(null)
  const previousLevel = useRef<number | null>(null)

  // Ловим повышение уровня между обновлениями профиля.
  useEffect(() => {
    const level = profile.data?.level
    if (!level) return
    if (previousLevel.current !== null && level.idx > previousLevel.current) {
      setCelebrate({ idx: level.idx, name: level.name })
      playSound('levelup')
      playVoice('level_up', profile.data?.login ?? null, profile.data?.login ?? null)
    }
    previousLevel.current = level.idx
  }, [profile.data])

  if (profile.isLoading) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Spinner />
      </div>
    )
  }

  if (!profile.data) {
    return (
      <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-mist-300">
          Аккаунт есть, но профиля в семье нет. Нужен код приглашения от родителя.
        </p>
        <Button variant="ghost" onClick={() => void signOut()}>
          Выйти
        </Button>
      </div>
    )
  }

  const me = profile.data
  const isAdmin = me.role === 'admin'

  const tabs = [
    { to: '/today', label: 'Сегодня', icon: '✅' },
    { to: '/progress', label: 'Прогресс', icon: '📈' },
    { to: '/rewards', label: 'Призы', icon: '🎁' },
    { to: '/feed', label: 'Лента', icon: '💬' },
  ]
  if (isAdmin) tabs.push({ to: '/admin', label: 'Админ', icon: '🛠' })

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-10 border-b border-white/10 bg-ink-950/85 backdrop-blur">
        <div className="mx-auto flex max-w-md items-center gap-3 px-4 py-3">
          <Avatar emoji={me.emoji} color={me.color} src={me.avatar_url} size="sm" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{me.display_name}</div>
            <div className="truncate text-xs text-mist-500">
              {me.level.name} · {me.level.idx} ур.
              {me.streak > 1 ? (
                <>
                  {' · '}
                  <span className="anim-flame">🔥 {me.streak}</span>
                </>
              ) : null}
            </div>
          </div>
          <div className="text-right">
            <div className="text-sm font-semibold text-accent">{me.coins} 🪙</div>
            <div className="text-xs text-mist-500">{me.xp_total} опыта</div>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-md px-4 pt-4 pb-28">
        <Outlet context={me} />
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-white/10 bg-ink-950/95 backdrop-blur safe-bottom">
        <div className="mx-auto flex max-w-md items-stretch">
          {tabs.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              className={({ isActive }) =>
                clsx(
                  'flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[11px] transition-colors',
                  isActive ? 'text-accent' : 'text-mist-500 hover:text-mist-300',
                )
              }
            >
              <span className="text-lg leading-none">{tab.icon}</span>
              {tab.label}
            </NavLink>
          ))}
        </div>
      </nav>

      {celebrate && <LevelUp level={celebrate} onDone={() => setCelebrate(null)} />}
    </div>
  )
}
