import type { Session } from '@supabase/supabase-js'
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { isAdmin } from '../lib/api'
import { errorMessage } from '../lib/errors'
import { supabase } from '../lib/supabase'

type AuthState =
  | { kind: 'loading' }
  | { kind: 'signed_out' }
  | { kind: 'recovery'; session: Session }
  | { kind: 'not_admin'; session: Session }
  | { kind: 'admin'; session: Session }
  | { kind: 'error'; message: string; session: Session | null }

interface AuthCtx {
  state: AuthState
  recheck: () => void
  endRecovery: () => void
}

const Ctx = createContext<AuthCtx | null>(null)

/** 비밀번호 재설정 메일의 링크에는 ?recovery=1 을 붙여 둔다 (PKCE code 와 함께 돌아옴) */
function cameFromRecoveryLink(): boolean {
  return new URLSearchParams(window.location.search).get('recovery') === '1'
}

function cleanAuthParams() {
  const url = new URL(window.location.href)
  let changed = false
  for (const k of ['code', 'recovery', 'error', 'error_code', 'error_description']) {
    if (url.searchParams.has(k)) {
      url.searchParams.delete(k)
      changed = true
    }
  }
  if (changed) history.replaceState(history.state, '', url.pathname + url.search + url.hash)
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ kind: 'loading' })
  const [tick, setTick] = useState(0)
  const [recovery, setRecovery] = useState(cameFromRecoveryLink)

  useEffect(() => {
    if (!supabase) return
    let alive = true
    const resolve = async (session: Session | null) => {
      if (!alive) return
      if (!session) {
        setState({ kind: 'signed_out' })
        return
      }
      if (recovery) {
        setState({ kind: 'recovery', session })
        return
      }
      try {
        const ok = await isAdmin()
        if (alive) setState(ok ? { kind: 'admin', session } : { kind: 'not_admin', session })
      } catch (e) {
        if (alive) setState({ kind: 'error', message: errorMessage(e), session })
      }
    }
    supabase.auth.getSession().then(({ data, error }) => {
      if (error) setState({ kind: 'error', message: errorMessage(error), session: null })
      else void resolve(data.session)
      cleanAuthParams()
    })
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') setRecovery(true)
      if (event === 'SIGNED_OUT') setState({ kind: 'signed_out' })
      else if (event === 'SIGNED_IN' || event === 'USER_UPDATED' || event === 'PASSWORD_RECOVERY') {
        // onAuthStateChange 콜백 안에서 바로 await 하지 않는다 (supabase-js 권장)
        setTimeout(() => void resolve(session), 0)
      }
    })
    return () => {
      alive = false
      sub.subscription.unsubscribe()
    }
  }, [tick, recovery])

  return (
    <Ctx.Provider
      value={{
        state,
        recheck: () => setTick((t) => t + 1),
        endRecovery: () => {
          setRecovery(false)
          setTick((t) => t + 1)
        },
      }}
    >
      {children}
    </Ctx.Provider>
  )
}

export function useAuth(): AuthCtx {
  const c = useContext(Ctx)
  if (!c) throw new Error('AuthProvider 가 없습니다.')
  return c
}

export function currentEmail(state: AuthState): string | null {
  return 'session' in state && state.session ? (state.session.user.email ?? null) : null
}
