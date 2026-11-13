import { describe, expect, it } from 'vitest'
import { isIdAccount, loginDisplayName, loginTarget } from './loginId'

describe('아이디 로그인', () => {
  it('아이디는 앱 전용 주소로 바꾼다 (대소문자·앞뒤 공백 무시)', () => {
    expect(loginTarget('admin')).toEqual({ ok: true, email: 'admin@high-guild.github.io', isId: true })
    expect(loginTarget('  Admin ')).toEqual({ ok: true, email: 'admin@high-guild.github.io', isId: true })
  })
  it('이메일은 그대로 쓴다', () => {
    expect(loginTarget('me@example.com')).toEqual({ ok: true, email: 'me@example.com', isId: false })
  })
  it('빈 값과 잘못된 아이디는 거부한다', () => {
    expect(loginTarget('').ok).toBe(false)
    expect(loginTarget('a').ok).toBe(false)
    expect(loginTarget('관리자').ok).toBe(false)
    expect(loginTarget('ad min').ok).toBe(false)
  })
  it('표시용 이름은 아이디 계정이면 아이디만 보여준다', () => {
    expect(loginDisplayName('admin@high-guild.github.io')).toBe('admin')
    expect(loginDisplayName('me@example.com')).toBe('me@example.com')
    expect(isIdAccount('admin@high-guild.github.io')).toBe(true)
    expect(isIdAccount('me@example.com')).toBe(false)
  })
})
