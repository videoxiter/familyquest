import { Navigate, Route, Routes } from 'react-router-dom'
import { isConfigured } from './lib/supabase'
import { useSession } from './session'
import { Spinner } from './components/ui'
import Admin from './pages/Admin'
import Feed from './pages/Feed'
import Layout from './pages/Layout'
import Login from './pages/Login'
import Progress from './pages/Progress'
import Rewards from './pages/Rewards'
import Today from './pages/Today'

export default function App() {
  const { session, loading } = useSession()

  if (!isConfigured) return <SetupNotice />

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Spinner />
      </div>
    )
  }

  if (!session) return <Login />

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/today" element={<Today />} />
        <Route path="/progress" element={<Progress />} />
        <Route path="/rewards" element={<Rewards />} />
        <Route path="/feed" element={<Feed />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="*" element={<Navigate to="/today" replace />} />
      </Route>
    </Routes>
  )
}

function SetupNotice() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center gap-4 px-6 py-10">
      <h1 className="text-2xl font-bold">FamilyQuest — нужна настройка</h1>
      <p className="text-sm text-mist-300">
        В сборке нет адреса и ключа Supabase. Это не ошибка приложения — заполни переменные окружения
        и пересобери.
      </p>
      <ol className="space-y-2 text-sm text-mist-300">
        <li>
          1. Скопируй <code className="rounded bg-white/10 px-1">.env.example</code> в{' '}
          <code className="rounded bg-white/10 px-1">.env.local</code>.
        </li>
        <li>
          2. Подставь значения из Supabase → Project Settings → API: Project URL и anon-ключ.
        </li>
        <li>
          3. Примени <code className="rounded bg-white/10 px-1">supabase/apply_all.sql</code> в SQL
          Editor.
        </li>
        <li>4. Пересобери проект: npm run build.</li>
      </ol>
      <p className="text-xs text-mist-500">
        Для GitHub Pages те же значения кладутся в Settings → Secrets and variables → Actions
        (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY).
      </p>
    </div>
  )
}
