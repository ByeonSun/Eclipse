import { useState, type FormEvent, type ReactNode } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { Notice } from '../components/ui'
import { Wordmark } from '../components/Wordmark'
import { errorMessage } from '../lib/errors'
import { loginDisplayName, loginTarget } from '../lib/loginId'
import { appBaseUrl, configState, db } from '../lib/supabase'

function Gate({ children }: { children: ReactNode }) {
  return (
    <div className="gate">
      <div className="gate__inner">
        <div className="gate__crest">
          <Wordmark large />
        </div>
        <p className="gate__tagline">길드 보스 참여 관리</p>
        <div className="gate__divider" />
        {children}
      </div>
    </div>
  )
}

export function SetupPage() {
  const reason = configState.ok ? null : configState.reason
  return (
    <Gate>
      <div className="card">
        <h1>Supabase 연결 설정이 필요합니다</h1>
        {reason === 'secret_key' ? (
          <Notice tone="error">
            <p>
              비밀 키(service_role 또는 sb_secret_)가 프런트엔드 설정에 들어 있어 사용을 중단했습니다. 즉시 Supabase에서 해당
              키를 교체하고, 공개용 키(publishable 또는 anon)만 넣으세요.
            </p>
          </Notice>
        ) : reason === 'bad_url' ? (
          <Notice tone="error">
            <p>VITE_SUPABASE_URL 형식이 올바르지 않습니다. https:// 로 시작하는 프로젝트 주소를 넣으세요.</p>
          </Notice>
        ) : (
          <Notice tone="info">
            <p>저장된 기록을 불러오려면 Supabase 프로젝트 주소와 공개용 키가 필요합니다. 이 화면에는 예시 데이터를 표시하지 않습니다.</p>
          </Notice>
        )}
        <ol className="small" style={{ paddingLeft: 18, lineHeight: 1.8 }}>
          <li>
            <code>.env.local</code>(로컬) 또는 GitHub 저장소 Variables(배포)에 <code>VITE_SUPABASE_URL</code>,{' '}
            <code>VITE_SUPABASE_PUBLISHABLE_KEY</code> 를 설정합니다.
          </li>
          <li>
            <code>supabase/migrations</code> 의 SQL 세 개를 순서대로 적용합니다.
          </li>
          <li>최초 관리자를 Supabase 대시보드에서 만들고 admin_users 에 등록합니다.</li>
        </ol>
        <p className="small muted mb-0">자세한 절차는 저장소 README 의 “Supabase 설정”을 참고하세요.</p>
      </div>
    </Gate>
  )
}

export function LoginPage() {
  const [mode, setMode] = useState<'login' | 'forgot'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    const target = loginTarget(email)
    if (!target.ok) return setError(target.error)
    if (mode === 'forgot' && target.isId) {
      return setError(
        '아이디로 만든 계정은 메일로 재설정할 수 없습니다. Supabase 대시보드 → Authentication → Users 에서 해당 계정의 비밀번호를 바꾸세요.',
      )
    }
    setBusy(true)
    try {
      if (mode === 'login') {
        const { error } = await db().auth.signInWithPassword({ email: target.email, password })
        if (error) throw error
        setPassword('')
      } else {
        const { error } = await db().auth.resetPasswordForEmail(target.email, {
          redirectTo: `${appBaseUrl()}?recovery=1`,
        })
        if (error) throw error
        setSent(true)
      }
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Gate>
      <form className="card" onSubmit={submit} noValidate>
        <h1>{mode === 'login' ? '관리자 로그인' : '비밀번호 재설정'}</h1>
        {error && (
          <Notice tone="error">
            <p>{error}</p>
          </Notice>
        )}
        {sent && mode === 'forgot' ? (
          <Notice tone="ok">
            <p>
              관리자 계정이 맞다면 재설정 메일이 발송됩니다. 메일의 링크를 <strong>이 브라우저</strong>에서 열어 새 비밀번호를
              정하세요.
            </p>
          </Notice>
        ) : null}
        <div className="field">
          <label htmlFor="email">이메일</label>
          <input
            id="email"
            className="input"
            type="text"
            inputMode="email"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus
          />
        </div>
        {mode === 'login' && (
          <div className="field">
            <label htmlFor="password">비밀번호</label>
            <input
              id="password"
              className="input"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
        )}
        <button
          type="submit"
          className="btn btn--primary"
          style={{ width: '100%', minHeight: 42 }}
          disabled={busy || !email.trim() || (mode === 'login' && !password)}
        >
          {busy ? <span className="spinner" aria-hidden="true" /> : null}
          {mode === 'login' ? (busy ? '확인 중…' : '로그인') : busy ? '보내는 중…' : '재설정 메일 보내기'}
        </button>
        <div className="row row--between" style={{ marginTop: 12 }}>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => {
              setMode(mode === 'login' ? 'forgot' : 'login')
              setError(null)
              setSent(false)
            }}
          >
            {mode === 'login' ? '비밀번호를 잊으셨나요?' : '로그인으로 돌아가기'}
          </button>
          <span className="small muted">공개 회원가입 없음</span>
        </div>
      </form>
    </Gate>
  )
}

export function RecoveryPage() {
  const { endRecovery } = useAuth()
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (pw !== pw2) {
      setError('두 비밀번호가 일치하지 않습니다.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const { error } = await db().auth.updateUser({ password: pw })
      if (error) throw error
      setDone(true)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Gate>
      <form className="card" onSubmit={submit}>
        <h1>새 비밀번호 설정</h1>
        {error && (
          <Notice tone="error">
            <p>{error}</p>
          </Notice>
        )}
        {done ? (
          <>
            <Notice tone="ok">
              <p>비밀번호를 변경했습니다.</p>
            </Notice>
            <button type="button" className="btn btn--primary" style={{ width: '100%' }} onClick={endRecovery}>
              계속하기
            </button>
          </>
        ) : (
          <>
            <PasswordFields pw={pw} pw2={pw2} setPw={setPw} setPw2={setPw2} />
            <button type="submit" className="btn btn--primary" style={{ width: '100%' }} disabled={busy || !pw || !pw2}>
              {busy ? '저장 중…' : '비밀번호 변경'}
            </button>
          </>
        )}
      </form>
    </Gate>
  )
}

export function PasswordFields({
  pw,
  pw2,
  setPw,
  setPw2,
}: {
  pw: string
  pw2: string
  setPw: (v: string) => void
  setPw2: (v: string) => void
}) {
  const mismatch = pw2 !== '' && pw !== pw2
  return (
    <>
      <div className="field">
        <label htmlFor="new-pw">새 비밀번호</label>
        <input
          id="new-pw"
          className="input"
          type="password"
          autoComplete="new-password"
          minLength={8}
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          aria-describedby="new-pw-hint"
        />
        <span id="new-pw-hint" className="field__hint">
          8자 이상. Supabase 비밀번호 정책이 더 엄격하면 그 정책을 따릅니다.
        </span>
      </div>
      <div className="field">
        <label htmlFor="new-pw2">새 비밀번호 확인</label>
        <input
          id="new-pw2"
          className="input"
          type="password"
          autoComplete="new-password"
          value={pw2}
          onChange={(e) => setPw2(e.target.value)}
          aria-invalid={mismatch}
          aria-describedby={mismatch ? 'new-pw2-err' : undefined}
        />
        {mismatch && (
          <span id="new-pw2-err" className="field__hint" style={{ color: 'var(--danger)' }}>
            두 비밀번호가 일치하지 않습니다.
          </span>
        )}
      </div>
    </>
  )
}

export function NotAdminPage({ email, message }: { email: string | null; message?: string }) {
  return (
    <Gate>
      <div className="card">
        <h1>{message ? '연결 오류' : '관리자 권한이 없습니다'}</h1>
        <Notice tone={message ? 'error' : 'warn'}>
          <p>
            {message ??
              `${loginDisplayName(email) ?? '이 계정'}은(는) 관리자 목록(admin_users)에 등록되어 있지 않습니다. 관리자 등록은 Supabase 운영 절차로만 할 수 있습니다.`}
          </p>
        </Notice>
        <div className="row">
          {message && (
            <button type="button" className="btn" onClick={() => window.location.reload()}>
              다시 시도
            </button>
          )}
          <button type="button" className="btn" onClick={() => void db().auth.signOut()}>
            로그아웃
          </button>
        </div>
      </div>
    </Gate>
  )
}
