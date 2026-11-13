import { useState, type FormEvent } from 'react'
import { currentEmail, useAuth } from '../auth/AuthProvider'
import { Notice, useToast } from '../components/ui'
import { errorMessage } from '../lib/errors'
import { db } from '../lib/supabase'
import { PasswordFields } from './AuthPages'

export function SettingsPage() {
  const { state } = useAuth()
  const email = currentEmail(state)
  const toast = useToast()
  const [current, setCurrent] = useState('')
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setDone(false)
    if (pw !== pw2) return setError('두 비밀번호가 일치하지 않습니다.')
    if (pw === current) return setError('새 비밀번호가 현재 비밀번호와 같습니다.')
    if (!email) return setError('로그인 정보를 확인할 수 없습니다. 다시 로그인하세요.')
    setBusy(true)
    try {
      // 현재 비밀번호 재확인 (재인증)
      const re = await db().auth.signInWithPassword({ email, password: current })
      if (re.error) throw new Error('현재 비밀번호가 올바르지 않습니다.')
      const { error } = await db().auth.updateUser({ password: pw })
      if (error) throw error
      setCurrent('')
      setPw('')
      setPw2('')
      setDone(true)
      toast('ok', '비밀번호를 변경했습니다.')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page page--narrow">
      <div className="page-head">
        <div>
          <h1>관리자 설정</h1>
          <p>로그인 계정: {email ?? '-'} (화면 표시명 admin)</p>
        </div>
      </div>

      <form className="card" onSubmit={submit}>
        <div className="card__head">
          <h2 className="card__title">비밀번호 변경</h2>
        </div>
        {error && (
          <Notice tone="error">
            <p>{error}</p>
          </Notice>
        )}
        {done && (
          <Notice tone="ok" live>
            <p>비밀번호를 변경했습니다. 다음 로그인부터 새 비밀번호를 사용하세요.</p>
          </Notice>
        )}
        <input type="email" autoComplete="username" value={email ?? ''} readOnly hidden />
        <div className="field">
          <label htmlFor="cur-pw">현재 비밀번호</label>
          <input
            id="cur-pw"
            className="input"
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </div>
        <PasswordFields pw={pw} pw2={pw2} setPw={setPw} setPw2={setPw2} />
        <div className="row row--end">
          <button type="submit" className="btn btn--primary" disabled={busy || !current || !pw || !pw2}>
            {busy ? '변경 중…' : '비밀번호 변경'}
          </button>
        </div>
      </form>

      <div className="card">
        <div className="card__head">
          <h2 className="card__title">로그아웃</h2>
        </div>
        <p className="card__hint" style={{ marginBottom: 12 }}>
          이 브라우저의 로그인 세션을 종료합니다.
        </p>
        <button type="button" className="btn" onClick={() => void db().auth.signOut()}>
          로그아웃
        </button>
      </div>
    </div>
  )
}
