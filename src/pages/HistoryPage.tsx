import { useCallback, useEffect, useState } from 'react'
import { MemberSearch } from '../components/MemberSearch'
import { Empty, ErrorNotice, LevelBadge, Loading, useLatest } from '../components/ui'
import { useRoster } from '../data/RosterProvider'
import { listRuns, type RunSummary } from '../lib/api'
import { BOSS_LEVELS } from '../lib/constants'
import { errorMessage } from '../lib/errors'
import { href, navigate, useRoute } from '../lib/router'
import { formatKst, isValidDateString, kstDateSpan, kstDateString, kstMonthStart } from '../lib/time'

export function HistoryPage() {
  const route = useRoute()
  const roster = useRoster()
  const latest = useLatest()
  const today = kstDateString(new Date())
  const q = route.query
  const start = q.get('start') ?? kstDateString(kstMonthStart(new Date()))
  const end = q.get('end') ?? today
  const level = Number(q.get('level')) || null
  const memberId = q.get('member')
  const showCancelled = q.get('cancelled') === '1'
  const [runs, setRuns] = useState<RunSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const setQuery = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(q)
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === '') next.delete(k)
      else next.set(k, v)
    }
    navigate(`/history?${next.toString()}`, { replace: true })
  }

  const valid = isValidDateString(start) && isValidDateString(end) && start <= end

  const load = useCallback(async () => {
    if (!valid) return
    const isLatest = latest()
    setLoading(true)
    setError(null)
    try {
      const span = kstDateSpan(start, end)
      const rows = await listRuns({ ...span, level, memberId, includeCancelled: showCancelled, limit: 1000 })
      if (isLatest()) setRuns(rows)
    } catch (e) {
      if (isLatest()) setError(errorMessage(e))
    } finally {
      if (isLatest()) setLoading(false)
    }
  }, [start, end, level, memberId, showCancelled, valid, latest])

  useEffect(() => {
    void load()
  }, [load])

  const member = memberId ? roster.byId.get(memberId) : null

  // 한국 날짜별로 묶기
  const groups = new Map<string, RunSummary[]>()
  for (const r of runs) {
    const d = kstDateString(new Date(r.occurred_at))
    groups.set(d, [...(groups.get(d) ?? []), r])
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>날짜별 이력</h1>
          <p>날짜는 한국 시각 기준 00:00 ~ 23:59 로 나눕니다.</p>
        </div>
        <a className="btn btn--primary" href={href('/record/new')}>
          + 참여 기록 추가
        </a>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="row" style={{ alignItems: 'flex-end', gap: 12 }}>
          <div className="field mb-0">
            <label htmlFor="h-start">시작일</label>
            <input id="h-start" className="input" type="date" value={start} max={end} onChange={(e) => setQuery({ start: e.target.value })} />
          </div>
          <div className="field mb-0">
            <label htmlFor="h-end">종료일</label>
            <input id="h-end" className="input" type="date" value={end} min={start} onChange={(e) => setQuery({ end: e.target.value })} />
          </div>
          <div className="row" style={{ gap: 4 }}>
            <button type="button" className="btn btn--sm" onClick={() => setQuery({ start: today, end: today })}>
              오늘
            </button>
            <button
              type="button"
              className="btn btn--sm"
              onClick={() => setQuery({ start: kstDateString(kstMonthStart(new Date())), end: today })}
            >
              이번 달
            </button>
          </div>
          <div className="field mb-0">
            <label htmlFor="h-level">보스 레벨</label>
            <select id="h-level" className="select" value={level ?? ''} onChange={(e) => setQuery({ level: e.target.value || null })}>
              <option value="">전체</option>
              {BOSS_LEVELS.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          <div className="field mb-0" style={{ minWidth: 240, flex: 1 }}>
            <span className="field__label">길드원</span>
            {member ? (
              <div className="row">
                <span className="chip">
                  {member.nickname}
                  <button type="button" aria-label="길드원 필터 해제" onClick={() => setQuery({ member: null })}>
                    ✕
                  </button>
                </span>
              </div>
            ) : (
              <MemberSearch label="길드원 필터" onSelect={(m) => setQuery({ member: m.id })} />
            )}
          </div>
          <label className="checkbox">
            <input type="checkbox" checked={showCancelled} onChange={(e) => setQuery({ cancelled: e.target.checked ? '1' : null })} />
            취소 회차 포함
          </label>
        </div>
        {!valid && <p className="small" style={{ color: 'var(--danger)', margin: '8px 0 0' }}>날짜 범위를 확인하세요.</p>}
      </div>

      {error && <ErrorNotice message={error} onRetry={load} />}
      {loading && !runs.length ? (
        <Loading />
      ) : runs.length === 0 ? (
        <div className="card">
          <Empty title="조건에 맞는 보스 기록이 없습니다">
            <p>기간이나 필터를 바꿔 보세요.</p>
          </Empty>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <caption className="sr-only">보스 회차 목록</caption>
            <thead>
              <tr>
                <th scope="col">날짜 (KST)</th>
                <th scope="col">처치 시각</th>
                <th scope="col">레벨</th>
                <th scope="col" className="num">
                  참여
                </th>
                <th scope="col">메모</th>
                <th scope="col">상태</th>
              </tr>
            </thead>
            <tbody>
              {[...groups.entries()].map(([day, list]) =>
                list.map((r, i) => (
                  <tr key={r.id} className={r.cancelled_at ? 'is-cancelled' : undefined}>
                    <td>{i === 0 ? <strong>{day}</strong> : ''}</td>
                    <td>
                      <a className="row-link" href={href(`/runs/${r.id}`)}>
                        {formatKst(r.occurred_at).slice(-5)}
                      </a>
                    </td>
                    <td>
                      <LevelBadge level={r.boss_level} />
                    </td>
                    <td className="num">{r.attendances[0]?.count ?? 0}명</td>
                    <td style={{ whiteSpace: 'normal', maxWidth: 320 }}>{r.note}</td>
                    <td>
                      {r.cancelled_at ? (
                        <span className="badge badge--danger">
                          <span aria-hidden="true">✕</span>취소
                        </span>
                      ) : (
                        <span className="badge badge--ok">
                          <span aria-hidden="true">✓</span>유효
                        </span>
                      )}
                    </td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
      )}
      <p className="small muted">{runs.length}건{runs.length >= 1000 ? ' (최대 1000건까지 표시 — 기간을 좁혀 주세요)' : ''}</p>
    </div>
  )
}
