import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/** Настроен ли проект: без URL и anon-ключа приложение показывает инструкцию. */
export const isConfigured = Boolean(url && anonKey)

// anon-ключ публичен по замыслу (он всё равно уезжает в JS-бандл).
// Доступ к данным ограничивают RLS-политики и RPC-функции.
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
