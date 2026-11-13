import type { ReactNode } from 'react'
import { currentEmail, useAuth } from '../auth/AuthProvider'
import { isIdAccount, loginDisplayName } from '../lib/loginId'
import { href, useRoute } from '../lib/router'
import { Wordmark } from './Wordmark'

const NAV = [
  { to: '/', label: '대시보드', match: (p: string) => p === '/' },
  { to: '/record/new', label: '기록 작성', match: (p: string) => p.startsWith('/record') },
  { to: '/sheet', label: '참여율 시트', match: (p: string) => p.startsWith('/sheet') },
  { to: '/history', label: '날짜별 이력', match: (p: string) => p.startsWith('/history') || p.startsWith('/runs') },
  { to: '/members', label: '길드원 관리', match: (p: string) => p.startsWith('/members') },
  { to: '/settings', label: '설정', match: (p: string) => p.startsWith('/settings') },
]

export function Layout({ children }: { children: ReactNode }) {
  const route = useRoute()
  const { state } = useAuth()
  const email = currentEmail(state)
  return (
    <>
      <a href="#main" className="skip-link" onClick={(e) => {
        e.preventDefault()
        document.getElementById('main')?.focus()
      }}>
        본문으로 건너뛰기
      </a>
      <header className="topbar">
        <a href={href('/')} className="wordmark" aria-label="하이 보스 참여 관리 홈">
          <Wordmark />
        </a>
        <nav className="nav" aria-label="주 메뉴">
          {NAV.map((n) => (
            <a key={n.to} href={href(n.to)} aria-current={n.match(route.path) ? 'page' : undefined}>
              {n.label}
            </a>
          ))}
        </nav>
        <div className="topbar__user" title={email ?? undefined}>
          <span aria-hidden="true">⚜</span>
          <span>{isIdAccount(email) ? loginDisplayName(email) : 'admin'}</span>
        </div>
      </header>
      <main id="main" tabIndex={-1} style={{ outline: 'none' }}>
        {children}
      </main>
    </>
  )
}
