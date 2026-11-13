import { useCallback, useEffect, useMemo, useState } from 'react'
import { MemberSearch } from '../components/MemberSearch'
import { PeriodFilter } from '../components/PeriodFilter'
import { Dialog, Empty, ErrorNotice, Loading, MemberStatusBadge, useLatest } from '../components/ui'
import { useRoster } from '../data/RosterProvider'
import { activeAt, fetchMemberRuns, fetchStats, memberStatus, type Member, type MemberRunRow } from '../lib/api'
import { BOSS_LEVELS, RATE_BASIS_NOTE, type BossLevel } from '../lib/constants'
import { csvBlob, downloadBlob } from '../lib/csv'
import { errorMessage } from '../lib/errors'
import { normalizeName } from '../lib/normalize'
import { href, navigate, useRoute } from '../lib/router'
import { aggregateStats, emptyStats, formatRate, rateValue, type MemberStats } from '../lib/stats'
import { formatKst, kstDateString, periodFromQuery, periodToQuery, resolvePeriod, type Period } from '../lib/time'

type SortKey = 'nickname' | 'total' | BossLevel
interface Row {
  member: Member
  stats: MemberStats
}

export function SheetPage() {
  const route = useRoute()
  const roster = useRoster()
  const latest = useLatest()
  const period = periodFromQuery(route.query, 'month')
  const resolved = resolvePeriod(period)
  const [statsMap, setStatsMap] = useState<Map<string, MemberStats>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'nickname', dir: 1 })
  const [showAll, setShowAll] = useState(false)
  const [cell, setCell] = useState<{ member: Member; level: BossLevel | 'total' } | null>(null)

  const setPeriod = (p: Period) => navigate(`/sheet?${periodToQuery(p)}`, { replace: true })
  const periodKey = periodToQuery(period)

  const load = useCallback(async () => {
    if (!resolved.valid) return
    const isLatest = latest()
    setLoading(true)
    setError(null)
    try {
      const rows = await fetchStats(resolved.from, resolved.to)
      if (isLatest()) setStatsMap(aggregateStats(rows))
    } catch (e) {
      if (isLatest()) setError(errorMessage(e))
    } finally {
      if (isLatest()) setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodKey, latest])

  useEffect(() => {
    void load()
  }, [load])

  const rows: Row[] = useMemo(() => {
    const now = new Date()
    const key = normalizeName(filter)
    const list: Row[] = []
    for (const m of roster.members) {
      const stats = statsMap.get(m.id) ?? emptyStats()
      const visible = showAll || stats.total.eligible > 0 || (!m.archived_at && activeAt(m, now))
      if (!visible) continue
      if (
        key &&
        !normalizeName(m.nickname).includes(key) &&
        !m.member_aliases.some((a) => normalizeName(a.alias).includes(key))
      )
        continue
      list.push({ member: m, stats })
    }
    const val = (r: Row): number | null => {
      if (sort.key === 'nickname') return null
      const c = sort.key === 'total' ? r.stats.total : r.stats.levels[sort.key]
      return rateValue(c.attended, c.eligible)
    }
    return list.sort((a, b) => {
      if (sort.key === 'nickname') return sort.dir * a.member.nickname.localeCompare(b.member.nickname, 'ko')
      const va = val(a)
      const vb = val(b)
      // 분모 0("—")은 항상 맨 뒤
      if (va === null && vb === null) return a.member.nickname.localeCompare(b.member.nickname, 'ko')
      if (va === null) return 1
      if (vb === null) return -1
      return sort.dir * (va - vb) || a.member.nickname.localeCompare(b.member.nickname, 'ko')
    })
  }, [roster.members, statsMap, filter, sort, showAll])

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: key === 'nickname' ? 1 : -1 }))

  const sortLabel = (key: SortKey) => (sort.key === key ? (sort.dir === 1 ? ' ▲' : ' ▼') : '')
  const ariaSort = (key: SortKey) => (sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none')

  const exportCsv = () => {
    const header = ['닉네임', '상태', '전체 참여율', '전체 참여', '전체 가능']
    for (const l of BOSS_LEVELS) header.push(`${l} 참여율`, `${l} 참여`, `${l} 가능`)
    const data = rows.map((r) => {
      const out: (string | number)[] = [
        r.member.nickname,
        memberStatus(r.member).label,
        formatRate(r.stats.total.attended, r.stats.total.eligible),
        r.stats.total.attended,
        r.stats.total.eligible,
      ]
      for (const l of BOSS_LEVELS) {
        const c = r.stats.levels[l]
        out.push(formatRate(c.attended, c.eligible), c.attended, c.eligible)
      }
      return out
    })
    const meta = [[`${RATE_BASIS_NOTE} · 기간: ${resolved.label} · 내보낸 시각: ${formatKst(new Date())} KST`]]
    downloadBlob(csvBlob([...meta, header, ...data]), `하이-참여율-${kstDateString(new Date())}.csv`)
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>참여율 시트</h1>
          <p>
            {RATE_BASIS_NOTE} · 셀 = 참여율 · 참여/참여 가능 · 가입 전·탈퇴 후·취소 회차 제외 · 전체 = 전체 참여 횟수 ÷ 전체 참여
            가능 횟수
          </p>
        </div>
        <div className="page-head__actions">
          <button type="button" className="btn" onClick={exportCsv} disabled={loading || rows.length === 0}>
            CSV 내보내기
          </button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="row" style={{ gap: 12 }}>
          <MemberSearch onSelect={(m) => navigate(`/members/${m.id}?${periodToQuery(period)}`)} />
          <PeriodFilter value={period} onChange={setPeriod} />
        </div>
        <div className="row" style={{ marginTop: 10, gap: 12 }}>
          <label className="sr-only" htmlFor="sheet-filter">
            표 안에서 닉네임 거르기
          </label>
          <input
            id="sheet-filter"
            className="input input--sm"
            style={{ maxWidth: 240 }}
            placeholder="표 안에서 거르기 (닉네임·별칭)"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <label className="checkbox small">
            <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
            기간 중 재적 기록이 없는 길드원도 표시
          </label>
          <span className="small muted">{rows.length}명</span>
        </div>
      </div>

      {error && <ErrorNotice message={error} onRetry={load} />}
      {roster.error && <ErrorNotice message={`명단: ${roster.error}`} onRetry={roster.reload} />}
      {!resolved.valid ? (
        <p className="muted">{resolved.error}</p>
      ) : (loading && statsMap.size === 0) || (roster.loading && !roster.members.length) ? (
        <Loading label="참여율 계산 중…" />
      ) : rows.length === 0 ? (
        <div className="card">
          <Empty title={roster.members.length ? '표시할 길드원이 없습니다' : '등록된 길드원이 없습니다'}>
            {!roster.members.length && (
              <a className="btn btn--primary" href={href('/members')}>
                길드원 등록하기
              </a>
            )}
          </Empty>
        </div>
      ) : (
        <div className="table-wrap" aria-busy={loading}>
          <table className="table table--sheet">
            <caption className="sr-only">길드원별 보스 레벨별 참여율 ({resolved.label})</caption>
            <thead>
              <tr>
                <th scope="col" aria-sort={ariaSort('nickname')}>
                  <button type="button" className="sort-btn" onClick={() => toggleSort('nickname')}>
                    닉네임{sortLabel('nickname')}
                  </button>
                </th>
                <th scope="col" className="cell--total" aria-sort={ariaSort('total')} style={{ textAlign: 'center' }}>
                  <button type="button" className="sort-btn" onClick={() => toggleSort('total')}>
                    전체{sortLabel('total')}
                  </button>
                </th>
                {BOSS_LEVELS.map((l) => (
                  <th key={l} scope="col" aria-sort={ariaSort(l)} style={{ textAlign: 'center' }}>
                    <button type="button" className="sort-btn" onClick={() => toggleSort(l)}>
                      {l}
                      {sortLabel(l)}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const st = memberStatus(r.member)
                return (
                  <tr key={r.member.id}>
                    <th scope="row" style={{ fontWeight: 500 }}>
                      <a className="row-link" href={href(`/members/${r.member.id}?${periodToQuery(period)}`)}>
                        {r.member.nickname}
                      </a>{' '}
                      {st.tone !== 'active' && <MemberStatusBadge {...st} />}
                    </th>
                    <RateCell
                      total
                      c={r.stats.total}
                      label={`${r.member.nickname} 전체`}
                      onClick={() => setCell({ member: r.member, level: 'total' })}
                    />
                    {BOSS_LEVELS.map((l) => (
                      <RateCell
                        key={l}
                        c={r.stats.levels[l]}
                        label={`${r.member.nickname} ${l}레벨`}
                        onClick={() => setCell({ member: r.member, level: l })}
                      />
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <CellDialog cell={cell} period={period} onClose={() => setCell(null)} />
    </div>
  )
}

function RateCell({ c, onClick, label, total }: { c: { attended: number; eligible: number }; onClick: () => void; label: string; total?: boolean }) {
  const rate = formatRate(c.attended, c.eligible)
  return (
    <td className={`cell${c.eligible ? '' : ' cell--none'}${total ? ' cell--total' : ''}`}>
      <button type="button" onClick={onClick} aria-label={`${label}: ${rate}, ${c.attended}/${c.eligible}회. 계산 내역 보기`}>
        <span className="cell__rate">{rate}</span>
        <span className="cell__count">
          {c.attended}/{c.eligible}
        </span>
      </button>
    </td>
  )
}

/** 셀 클릭 시: 그 칸 계산에 쓰인 회차와 참여 여부 */
function CellDialog({
  cell,
  period,
  onClose,
}: {
  cell: { member: Member; level: BossLevel | 'total' } | null
  period: Period
  onClose: () => void
}) {
  const latest = useLatest()
  const [rows, setRows] = useState<MemberRunRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const resolved = resolvePeriod(period)

  useEffect(() => {
    if (!cell) return
    const isLatest = latest()
    setRows(null)
    setError(null)
    fetchMemberRuns(cell.member.id, resolved.from, resolved.to)
      .then((r) => isLatest() && setRows(cell.level === 'total' ? r : r.filter((x) => x.boss_level === cell.level)))
      .catch((e) => isLatest() && setError(errorMessage(e)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cell, latest])

  const attended = rows?.filter((r) => r.attended).length ?? 0
  return (
    <Dialog
      open={!!cell}
      onClose={onClose}
      title={cell ? `${cell.member.nickname} · ${cell.level === 'total' ? '전체' : `${cell.level}레벨`} 계산 내역` : ''}
    >
      <p className="small muted" style={{ marginTop: 0 }}>
        {resolved.label} · 재적 중이던 유효 회차만 분모에 들어갑니다.
      </p>
      {error && <ErrorNotice message={error} />}
      {!rows && !error && <Loading />}
      {rows && rows.length === 0 && <Empty title="참여 가능 기록 없음">분모가 0이라 참여율은 “—”로 표시됩니다.</Empty>}
      {rows && rows.length > 0 && (
        <>
          <p className="strong">
            {formatRate(attended, rows.length)} · {attended}/{rows.length}
          </p>
          <div className="table-wrap" style={{ maxHeight: 400 }}>
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">처치 시각</th>
                  <th scope="col">레벨</th>
                  <th scope="col">참여</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.boss_run_id}>
                    <td>
                      <a className="row-link" href={href(`/runs/${r.boss_run_id}`)}>
                        {formatKst(r.occurred_at)}
                      </a>
                    </td>
                    <td>{r.boss_level}</td>
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Dialog>
  )
}
