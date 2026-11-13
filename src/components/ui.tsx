import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { MatchStatus } from '../lib/matching'
import { STATUS_LABEL } from '../lib/matching'

export function Loading({ label = '불러오는 중…' }: { label?: string }) {
  return (
    <div className="loading" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  )
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <p className="empty__title">{title}</p>
      {children}
    </div>
  )
}

type Tone = 'error' | 'warn' | 'ok' | 'info'
const ICON: Record<Tone, string> = { error: '!', warn: '⚠', ok: '✓', info: 'i' }

export function Notice({ tone, children, live }: { tone: Tone; children: ReactNode; live?: boolean }) {
  return (
    <div className={`notice notice--${tone}`} role={tone === 'error' ? 'alert' : live ? 'status' : undefined}>
      <span className="notice__icon" aria-hidden="true">
        {ICON[tone]}
      </span>
      <div>{children}</div>
    </div>
  )
}

export function ErrorNotice({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Notice tone="error">
      <p>{message}</p>
      {onRetry && (
        <button type="button" className="btn btn--sm" style={{ marginTop: 8 }} onClick={onRetry}>
          다시 시도
        </button>
      )}
    </Notice>
  )
}

export function LevelBadge({ level }: { level: number }) {
  return <span className="badge badge--level">Lv.{level}</span>
}

const STATUS_STYLE: Record<MatchStatus, { cls: string; icon: string }> = {
  exact: { cls: 'badge--ok', icon: '✓' },
  alias: { cls: 'badge--info', icon: '≈' },
  review: { cls: 'badge--warn', icon: '?' },
  unregistered: { cls: 'badge--danger', icon: '✕' },
  excluded: { cls: 'badge--muted', icon: '—' },
}

export function MatchBadge({ status }: { status: MatchStatus }) {
  const s = STATUS_STYLE[status]
  return (
    <span className={`badge ${s.cls}`}>
      <span aria-hidden="true">{s.icon}</span>
      {STATUS_LABEL[status]}
    </span>
  )
}

export function MemberStatusBadge({ tone, label }: { tone: 'active' | 'left' | 'pending' | 'archived'; label: string }) {
  const cls = { active: 'badge--ok', left: 'badge--muted', pending: 'badge--info', archived: 'badge--muted' }[tone]
  const icon = { active: '●', left: '○', pending: '◔', archived: '▢' }[tone]
  return (
    <span className={`badge ${cls}`}>
      <span aria-hidden="true">{icon}</span>
      {label}
    </span>
  )
}

export function Dialog({
  open,
  title,
  onClose,
  children,
  wide,
}: {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  wide?: boolean
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])
  return (
    <dialog
      ref={ref}
      className="dialog"
      style={wide ? { width: 'min(960px, calc(100vw - 24px))' } : undefined}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      aria-labelledby="dialog-title"
    >
      {open && (
        <>
          <div className="dialog__head">
            <h2 id="dialog-title">{title}</h2>
            <button type="button" className="btn btn--ghost btn--icon" onClick={onClose} aria-label="닫기">
              ✕
            </button>
          </div>
          <div className="dialog__body">{children}</div>
        </>
      )}
    </dialog>
  )
}

// ---------------------------------------------------------------------------
// 토스트
// ---------------------------------------------------------------------------
interface Toast {
  id: number
  tone: 'ok' | 'error' | 'info'
  text: string
}
const ToastCtx = createContext<(tone: Toast['tone'], text: string) => void>(() => {})

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([])
  const seq = useRef(0)
  const push = useCallback((tone: Toast['tone'], text: string) => {
    const id = ++seq.current
    setItems((xs) => [...xs, { id, tone, text }])
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), tone === 'error' ? 8000 : 4000)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite" role="status">
        {items.map((t) => (
          <div key={t.id} className={`toast toast--${t.tone}`}>
            <span aria-hidden="true">{t.tone === 'ok' ? '✓' : t.tone === 'error' ? '!' : 'i'}</span>
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

export function useToast() {
  return useContext(ToastCtx)
}

/** 최신 요청만 반영하는 비동기 로더 (빠른 전환 시 이전 응답이 덮어쓰지 않게) */
export function useLatest() {
  const seq = useRef(0)
  return useCallback(() => {
    const my = ++seq.current
    return () => my === seq.current
  }, [])
}
