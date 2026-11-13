import { useEffect, useState } from 'react'
import { MemberSearch } from '../components/MemberSearch'
import { PeriodFilter } from '../components/PeriodFilter'
import { Empty, ErrorNotice, LevelBadge, Loading, MemberStatusBadge, useLatest } from '../components/ui'
import { useRoster } from '../data/RosterProvider'
import { fetchMemberRuns, fetchStats, memberStatus, type MemberRunRow } from '../lib/api'
import { BOSS_LEVELS, RATE_BASIS_NOTE } from '../lib/constants'
import { errorMessage } from '../lib/errors'
import { href, navigate, useRoute } from '../lib/router'
import { aggregateStats, emptyStats, formatRate, type MemberStats } from '../lib/stats'
import { formatKst, periodFromQuery, periodToQuery, resolvePeriod, type Period } from '../lib/time'

interface Data {
  memberId: string
  stats: MemberStats
  runs: MemberRunRow[]
}

export function MemberDetailPage({ id }: { id: string }) {
  const route = useRoute()
  const roster = useRoster()
  const latest = useLatest()
  const period = periodFromQuery(route.query, 'month')
  const periodKey = periodToQuery(period)
  const resolved = resolvePeriod(period)
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [levelFilter, setLevelFilter] = useState<number | null>(null)
  const [attFilter, setAttFilter] = useState<'all' | 'yes' | 'no'>('all')
  const [reloadTick, setReloadTick] = useState(0)

  const member = roster.byId.get(id)

  useEffect(() => {
    if (!resolved.valid) return
    // 빠르게 다른 길드원을 고르면 이전 응답은 버린다 (member_id + 기간 기준 최신 요청만 반영)
    const isLatest = latest()
    setLoading(true)
    setError(null)
    Promise.all([fetchStats(resolved.from, resolved.to, id), fetchMemberRuns(id, resolved.from, resolved.to)])
      .then(([s, runs]) => {
        if (!isLatest()) return
        setData({ memberId: id, stats: aggregateStats(s).get(id) ?? emptyStats(), runs })
      })
      .catch((e) => isLatest() && setError(errorMessage(e)))
      .finally(() => isLatest() && setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, periodKey, reloadTick, latest])

  const setPeriod = (p: Period) => navigate(`/members/${id}?${periodToQuery(p)}`, { replace: true })

  if (roster.loading && !roster.members.length) return <div className="page"><Loading /></div>
  if (!member)
    return (
      <div className="page">
        {roster.error ? (
          <ErrorNotice message={roster.error} onRetry={roster.reload} />
        ) : (
          <Empty title="길드원을 찾을 수 없습니다">
            <a className="btn" href={href('/members')}>
              길드원 관리로
            </a>
          </Empty>
        )}
      </div>
    )

  const st = memberStatus(member)
  const current = data && data.memberId === id ? data : null
  const stats = current?.stats ?? emptyStats()
  const runs = (current?.runs ?? []).filter(
    (r) => (!levelFilter || r.boss_level === levelFilter) && (attFilter === 'all' || (attFilter === 'yes') === r.attended),
  )

  return (
    <div className="page">
      <div className="row row--between" style={{ marginBottom: 12 }}>
        <MemberSearch onSelect={(m) => navigate(`/members/${m.id}?${periodKey}`)} />
        <a className="small" href={href(`/sheet?${periodKey}`)}>
          ← 참여율 시트 (같은 기간)
        </a>
      </div>

      <div className="page-head">
        <div>
          <h1>
            {member.nickname} <MemberStatusBadge {...st} />
          </h1>
          <p>
            {member.member_aliases.length > 0 && <>별칭: {member.member_aliases.map((a) => a.alias).join(', ')} · </>}
            가입·탈퇴:{' '}
            {member.membership_periods
              .map((p) => `${formatKst(p.joined_at, { weekday: false })} ~ ${p.left_at ? formatKst(p.left_at, { weekday: false }) : '현재'}`)
              .join(' / ') || '이력 없음'}
          </p>
        </div>
        <div className="page-head__actions">
          <a className="btn" href={href(`/members?edit=${member.id}`)}>
            명단 정보 수정
          </a>
          <a className="btn" href={href(`/history?member=${member.id}`)}>
            참여 회차 이력
          </a>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <PeriodFilter value={period} onChange={setPeriod} />
      </div>

      {error && <ErrorNotice message={error} onRetry={() => setReloadTick((t) => t + 1)} />}

      <div className="grid grid--stats" style={{ marginBottom: 14 }} aria-busy={loading}>
        <div className="stat">
          <div className="stat__label">전체 참여율 ({resolved.label})</div>
          <div className="stat__value">
            {loading && !current ? '…' : formatRate(stats.total.attended, stats.total.eligible)}
            <small>
              {stats.total.attended}/{stats.total.eligible}
            </small>
          </div>
          {!loading && stats.total.eligible === 0 && <div className="small muted">참여 가능 기록 없음</div>}
        </div>
      </div>

      <section className="card" aria-labelledby="lv-rates" style={{ marginBottom: 14 }}>
        <div className="card__head">
          <h2 className="card__title" id="lv-rates">
            레벨별 참여율
          </h2>
          <span className="small muted">{RATE_BASIS_NOTE}</span>
        </div>
        <div className="table-wrap" style={{ maxHeight: 'none' }}>
          <table className="table">
            <thead>
              <tr>
                {BOSS_LEVELS.map((l) => (
                  <th key={l} scope="col" style={{ textAlign: 'center' }}>
                    {l}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                {BOSS_LEVELS.map((l) => {
                  const c = stats.levels[l]
                  return (
                    <td key={l} style={{ textAlign: 'center' }} className={c.eligible ? '' : 'cell--none'}>
                      <span className="cell__rate">{formatRate(c.attended, c.eligible)}</span>
                      <span className="cell__count">
                        {c.eligible ? `${c.attended}/${c.eligible}` : '기록 없음'}
                      </span>
                    </td>
                  )
                })}
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="card" aria-labelledby="run-list">
        <div className="card__head">
          <h2 className="card__title" id="run-list">
            참여 가능 회차 ({resolved.label})
          </h2>
          <div className="row">
            <label className="sr-only" htmlFor="md-level">
              레벨 필터
            </label>
            <select
              id="md-level"
              className="select select--sm"
              style={{ width: 110 }}
              value={levelFilter ?? ''}
              onChange={(e) => setLevelFilter(Number(e.target.value) || null)}
            >
              <option value="">전체 레벨</option>
              {BOSS_LEVELS.map((l) => (
                <option key={l} value={l}>
                  {l}레벨
                </option>
              ))}
            </select>
            <div className="segmented" role="group" aria-label="참여 여부">
              {(
                [
                  ['all', '전체'],
                  ['yes', '참여'],
                  ['no', '미참여'],
                ] as const
              ).map(([k, label]) => (
                <button key={k} type="button" aria-pressed={attFilter === k} onClick={() => setAttFilter(k)}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <p className="small muted" style={{ marginTop: 0 }}>
          가입 전·탈퇴 후 회차와 취소된 회차는 목록과 계산에서 제외됩니다.
        </p>
        {loading && !current ? (
          <Loading />
        ) : runs.length === 0 ? (
          <Empty title={current?.runs.length ? '필터에 맞는 회차가 없습니다' : '참여 가능 기록 없음'} />
        ) : (
          <div className="table-wrap" style={{ maxHeight: 480 }}>
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">처치 시각 (KST)</th>
                  <th scope="col">레벨</th>
                  <th scope="col">참여 여부</th>
                  <th scope="col">당시 닉네임</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.boss_run_id}>
                    <td>
                      <a className="row-link" href={href(`/runs/${r.boss_run_id}`)}>
                        {formatKst(r.occurred_at)}
                      </a>
                    </td>
                    <td>
                      <LevelBadge level={r.boss_level} />
                    </td>
                    <td>
                      {r.attended ? (
                        <span className="badge badge--ok">
                          <span aria-hidden="true">✓</span>참여
                        </span>
                      ) : (
                        <span className="badge badge--muted">
                          <span aria-hidden="true">✕</span>미참여
                        </span>
                      )}
                    </td>
                    <td>{r.nickname_snapshot ?? <span className="muted">-</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
