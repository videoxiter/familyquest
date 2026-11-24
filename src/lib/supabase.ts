import { createClient } from '@supabase/supabase-js'

// В CI переменные могут приходить пустыми строками (объявлены, но не заполнены),
// поэтому нормализуем: пустая строка → undefined. Иначе createClient('') бросает
// исключение ещё на импорте модуля и приложение показывает пустой экран.
function readEnv(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

const url = readEnv(import.meta.env.VITE_SUPABASE_URL)
const anonKey = readEnv(import.meta.env.VITE_SUPABASE_ANON_KEY)

/** Настроен ли проект: без URL и ключа приложение показывает инструкцию. */
export const isConfigured = Boolean(url && anonKey)

// Клиент создаём всегда: модули импортируют его на верхнем уровне.
// Заглушка безопасна — при !isConfigured приложение до сети не доходит.
export const supabase = createClient(
  url ?? 'https://placeholder.supabase.co',
  anonKey ?? 'public-anon-key',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  },
)
