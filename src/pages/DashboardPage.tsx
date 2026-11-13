import { useCallback, useEffect, useMemo, useState } from 'react'
import { MemberSearch } from '../components/MemberSearch'
import { PeriodFilter } from '../components/PeriodFilter'
import { Empty, ErrorNotice, LevelBadge, Loading, useLatest } from '../components/ui'
import { useRoster } from '../data/RosterProvider'
import { activeAt, fetchLevelCounts, listRuns, type RunSummary } from '../lib/api'
import { BOSS_LEVELS, RATE_BASIS_NOTE } from '../lib/constants'
import { errorMessage } from '../lib/errors'
import { href, navigate } from '../lib/router'
import { formatKst, periodToQuery, resolvePeriod, type Period } from '../lib/time'

export function DashboardPage() {
  const roster = useRoster()
  const latest = useLatest()
  const [period, setPeriod] = useState<Period>({ kind: 'week' })
  const [counts, setCounts] = useState<{ boss_level: number; runs: number; attendances: number }[]>([])
  const [recent, setRecent] = useState<RunSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const resolved = resolvePeriod(period)

  const load = useCallback(async () => {
    if (!resolved.valid) return
    const isLatest = latest()
    setLoading(true)
    setError(null)
    try {
      const [inPeriod, last] = await Promise.all([
        fetchLevelCounts(resolved.from, resolved.to),
        listRuns({ from: null, to: null, includeCancelled: true, limit: 8 }),
      ])
      if (!isLatest()) return
      setCounts(inPeriod)
      setRecent(last)
    } catch (e) {
      if (isLatest()) setError(errorMessage(e))
    } finally {
      if (isLatest()) setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period.kind, period.start, period.end, latest])

  useEffect(() => {
    void load()
  }, [load])

  const now = new Date()
  const currentMembers = roster.members.filter((m) => !m.archived_at && activeAt(m, now)).length
  const byLevel = useMemo(() => {
    const c = new Map<number, number>(BOSS_LEVELS.map((l) => [l, 0]))
    for (const r of counts) c.set(r.boss_level, r.runs)
    return c
  }, [counts])
  const maxLevel = Math.max(1, ...byLevel.values())
  const runTotal = counts.reduce((s, r) => s + r.runs, 0)
  const attendSum = counts.reduce((s, r) => s + r.attendances, 0)

  return (
    <div className="page">
      <section className="hall" aria-labelledby="hall-title">
        <div>
          <h1 className="hall__title" id="hall-title">
            <span>하이</span> 길드 본부
          </h1>
          <p className="hall__sub">보스 처치 후 캡처를 붙여넣고, 명단을 확인해 저장하세요.</p>
        </div>
        <div className="row">
          <MemberSearch onSelect={(m) => navigate(`/members/${m.id}?${periodToQuery(period)}`)} />
          <a className="btn btn--primary btn--hero" href={href('/record/new')}>
            + 참여 기록 추가
          </a>
        </div>
      </section>

      <div className="row row--between" style={{ marginBottom: 12 }}>
        <PeriodFilter value={period} onChange={setPeriod} />
      </div>

      {error && <ErrorNotice message={error} onRetry={load} />}
      {roster.error && <ErrorNotice message={`명단: ${roster.error}`} onRetry={roster.reload} />}

      <div className="grid grid--stats" style={{ marginBottom: 14 }}>
        <div className="stat">
          <div className="stat__label">현재 길드원</div>
          <div className="stat__value">
            {roster.loading && !roster.members.length ? '…' : currentMembers}
            <small>명</small>
          </div>
        </div>
        <div className="stat">
          <div className="stat__label">보스 기록 ({resolved.label})</div>
          <div className="stat__value">
            {loading ? '…' : runTotal}
            <small>회</small>
          </div>
        </div>
        <div className="stat">
          <div className="stat__label">누적 참여 인원 (같은 기간)</div>
          <div className="stat__value">
            {loading ? '…' : attendSum}
            <small>명·회</small>
          </div>
        </div>
      </div>

      <div className="grid grid--2">
        <section className="card" aria-labelledby="lv-title">
          <div className="card__head">
            <h2 className="card__title" id="lv-title">
              레벨별 기록 수
            </h2>
            <span className="small muted">취소 회차 제외</span>
          </div>
          <div className="level-bars" role="list">
            {BOSS_LEVELS.map((l) => {
              const n = byLevel.get(l) ?? 0
              return (
                <div className="level-bar" role="listitem" key={l} aria-label={`${l}레벨 ${n}회`}>
                  <div className="level-bar__count">{n}</div>
                  <div className="level-bar__track" aria-hidden="true">
                    <div className="level-bar__fill" style={{ height: `${(n / maxLevel) * 100}%` }} />
                  </div>
                  <div>{l}</div>
                </div>
              )
            })}
          </div>
          <p className="small muted" style={{ margin: '10px 0 0' }}>
            참여율은 {RATE_BASIS_NOTE}입니다. <a href={href(`/sheet?${periodToQuery(period)}`)}>참여율 시트 보기 →</a>
          </p>
        </section>

        <section className="card" aria-labelledby="recent-title">
          <div className="card__head">
            <h2 className="card__title" id="recent-title">
              최근 보스 참여 기록
            </h2>
            <a className="small" href={href('/history')}>
              전체 이력 →
            </a>
          </div>
          {loading && !recent.length ? (
            <Loading />
          ) : recent.length === 0 ? (
            <Empty title="아직 저장된 보스 기록이 없습니다">
              <p>첫 참여 기록을 추가해 보세요.</p>
              <a className="btn btn--primary" href={href('/record/new')}>
                참여 기록 추가
              </a>
            </Empty>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">처치 시각</th>
                  <th scope="col">레벨</th>
                  <th scope="col" className="num">
                    인원
                  </th>
                </tr>
              </thead>
              <tbody>
                {recent.map((r) => (
                  <tr key={r.id} className={r.cancelled_at ? 'is-cancelled' : undefined}>
                    <td>
                      <a className="row-link" href={href(`/runs/${r.id}`)}>
                        {formatKst(r.occurred_at)}
                      </a>
                      {r.cancelled_at && <span className="badge badge--danger" style={{ marginLeft: 6 }}>취소</span>}
                    </td>
                    <td>
                      <LevelBadge level={r.boss_level} />
                    </td>
                    <td className="num">{r.attendances[0]?.count ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  )
}
