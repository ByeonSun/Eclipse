// 아이디 로그인: Supabase Auth 는 이메일 형식이 필요하므로 아이디(예: admin)를 앱 전용 주소로 바꿔 쓴다.
// 이 주소는 실제 메일함이 아니다. 아이디 계정의 비밀번호 재설정은 Supabase 대시보드에서 한다.

export const LOGIN_ID_DOMAIN = 'high-guild.github.io'

const ID_RE = /^[a-z0-9][a-z0-9._-]{1,31}$/

export type LoginTarget = { ok: true; email: string; isId: boolean } | { ok: false; error: string }

/** 입력값이 이메일이면 그대로, 아이디면 앱 전용 주소로 */
export function loginTarget(input: string): LoginTarget {
  const v = input.trim()
  if (!v) return { ok: false, error: '아이디 또는 이메일을 입력하세요.' }
  if (v.includes('@')) return { ok: true, email: v, isId: false }
  const id = v.toLowerCase()
  if (!ID_RE.test(id)) {
    return { ok: false, error: '아이디는 영문 소문자·숫자·. _ - 로 2~32자입니다.' }
  }
  return { ok: true, email: `${id}@${LOGIN_ID_DOMAIN}`, isId: true }
}

/** 화면 표시용: 아이디 계정이면 아이디만, 아니면 이메일 */
export function loginDisplayName(email: string | null | undefined): string | null {
  if (!email) return null
  const suffix = `@${LOGIN_ID_DOMAIN}`
  return email.toLowerCase().endsWith(suffix) ? email.slice(0, -suffix.length) : email
}

export function isIdAccount(email: string | null | undefined): boolean {
  return !!email && email.toLowerCase().endsWith(`@${LOGIN_ID_DOMAIN}`)
}
