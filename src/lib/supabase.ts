import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim()
const key = (
  (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) ??
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)
)?.trim()

function looksSecret(k: string): boolean {
  // service_role(JWT role) 또는 sb_secret_ 키가 프런트엔드에 들어오면 사용하지 않는다.
  if (k.startsWith('sb_secret_')) return true
  const parts = k.split('.')
  if (parts.length === 3) {
    try {
      const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')))
      return payload?.role === 'service_role'
    } catch {
      return false
    }
  }
  return false
}

export type ConfigState = { ok: true } | { ok: false; reason: 'missing' | 'secret_key' | 'bad_url' }

export const configState: ConfigState = !url || !key
  ? { ok: false, reason: 'missing' }
  : looksSecret(key)
    ? { ok: false, reason: 'secret_key' }
    : !/^https:\/\/.+/.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1)/.test(url)
      ? { ok: false, reason: 'bad_url' }
      : { ok: true }

export const supabase: SupabaseClient | null = configState.ok
  ? createClient(url!, key!, {
      auth: {
        flowType: 'pkce',
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null

export function db(): SupabaseClient {
  if (!supabase) throw new Error('Supabase 연결 설정이 없습니다.')
  return supabase
}

/** 인증 메일의 돌아올 주소: 현재 앱의 기준 URL (GitHub Pages 하위 경로 포함) */
export function appBaseUrl(): string {
  return `${window.location.origin}${window.location.pathname}`
}
