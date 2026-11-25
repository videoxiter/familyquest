import { createClient } from '@supabase/supabase-js'

/**
 * Нормализация значения из переменных сборки.
 * Частые ошибки при копировании адреса проекта:
 *   «https://xxxx.supabase.co/rest/v1/» — адрес Data API вместо адреса проекта;
 *   кавычки, пробелы, лишний слэш на конце.
 * Из-за первого варианта все запросы уходят на /rest/v1/auth/v1/... и шлюз
 * Supabase отвечает «Invalid path specified in request URL».
 */
export function normalizeUrl(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined

  let value = raw.trim().replace(/^["']|["']$/g, '')
  if (!value) return undefined

  value = value.replace(/\/(rest|auth|storage|realtime|functions)\/v1\/?$/i, '')
  value = value.replace(/\/+$/, '')

  return value.length > 0 ? value : undefined
}

function normalizeKey(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  const value = raw.trim().replace(/^["']|["']$/g, '')
  return value.length > 0 ? value : undefined
}

const rawUrl = import.meta.env.VITE_SUPABASE_URL
const url = normalizeUrl(rawUrl)
const anonKey = normalizeKey(import.meta.env.VITE_SUPABASE_ANON_KEY)

if (typeof rawUrl === 'string' && url && rawUrl.trim() !== url) {
  console.warn('VITE_SUPABASE_URL содержал лишний путь и был исправлен на', url)
}

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
