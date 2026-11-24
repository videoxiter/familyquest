import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'

type SessionContextValue = {
  session: Session | null
  loading: boolean
}

const SessionContext = createContext<SessionContextValue>({ session: null, loading: true })

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true

    void supabase.auth.getSession().then(({ data }) => {
      if (!alive) return
      setSession(data.session)
      setLoading(false)
    })

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      setLoading(false)
    })

    return () => {
      alive = false
      data.subscription.unsubscribe()
    }
  }, [])

  const value = useMemo(() => ({ session, loading }), [session, loading])

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): SessionContextValue {
  return useContext(SessionContext)
}
