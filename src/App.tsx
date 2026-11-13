import { useEffect } from 'react'
import { currentEmail, useAuth } from './auth/AuthProvider'
import { Layout } from './components/Layout'
import { Empty, Loading } from './components/ui'
import { RosterProvider } from './data/RosterProvider'
import { APP_TITLE } from './lib/constants'
import { href, useRoute } from './lib/router'
import { configState } from './lib/supabase'
import { LoginPage, NotAdminPage, RecoveryPage, SetupPage } from './pages/AuthPages'
import { DashboardPage } from './pages/DashboardPage'
import { HistoryPage } from './pages/HistoryPage'
import { MemberDetailPage } from './pages/MemberDetailPage'
import { MembersPage } from './pages/MembersPage'
import { RecordPage } from './pages/RecordPage'
import { RunDetailPage } from './pages/RunDetailPage'
import { SettingsPage } from './pages/SettingsPage'
import { SheetPage } from './pages/SheetPage'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const TITLES: Record<string, string> = {
  '': '대시보드',
  record: '참여 기록 작성',
  sheet: '참여율 시트',
  history: '날짜별 이력',
  runs: '회차 상세',
  members: '길드원 관리',
  settings: '설정',
}

export function App() {
  if (!configState.ok) return <SetupPage />
  return <AuthedApp />
}

function AuthedApp() {
  const { state } = useAuth()
  switch (state.kind) {
    case 'loading':
      return (
        <div className="gate">
          <Loading label="로그인 상태 확인 중…" />
        </div>
      )
    case 'signed_out':
      return <LoginPage />
    case 'recovery':
      return <RecoveryPage />
    case 'not_admin':
      return <NotAdminPage email={currentEmail(state)} />
    case 'error':
      return <NotAdminPage email={currentEmail(state)} message={state.message} />
    case 'admin':
      return (
        <RosterProvider>
          <Layout>
            <Routes />
          </Layout>
        </RosterProvider>
      )
  }
}

function Routes() {
  const { segments, path } = useRoute()
  const [a, b, c] = segments

  useEffect(() => {
    document.title = `${TITLES[a ?? ''] ?? '하이'} · ${APP_TITLE}`
  }, [a])

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [path])

  if (!a) return <DashboardPage />
  if (a === 'record' && b === 'new') return <RecordPage key="new" />
  if (a === 'runs' && b && UUID.test(b) && c === 'edit') return <RecordPage key={`edit-${b}`} editId={b} />
  if (a === 'runs' && b && UUID.test(b) && !c) return <RunDetailPage id={b} />
  if (a === 'sheet') return <SheetPage />
  if (a === 'history') return <HistoryPage />
  if (a === 'members' && !b) return <MembersPage />
  if (a === 'members' && b && UUID.test(b)) return <MemberDetailPage key={b} id={b} />
  if (a === 'settings') return <SettingsPage />
  return (
    <div className="page">
      <Empty title="페이지를 찾을 수 없습니다">
        <a className="btn" href={href('/')}>
          대시보드로
        </a>
      </Empty>
    </div>
  )
}
