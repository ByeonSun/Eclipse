import { useEffect, useState } from 'react'
import { fetchStats } from '../lib/api'
import { BOSS_LEVELS } from '../lib/constants'
import { errorMessage } from '../lib/errors'
import { href } from '../lib/router'
import { aggregateGuild, formatRate } from '../lib/stats'
import { kstDateString, kstWeekRange } from '../lib/time'
import { ErrorNotice, useLatest } from './ui'

type Guild = ReturnType<typeof aggregateGuild>

/**
 * 길드 전체 주간 참여율 (KST 월요일 00:00 ~ 일요일 23:59).
 * = 그 주 모든 길드원의 참여 횟수 합 ÷ 참여 가능 횟수 합. 개인 계산과 같은 규칙(재적 기간, 취소 제외)을 쓴다.
 */
export function WeeklyGuildRate() {
  const latest = useLatest()
  const [offset, setOffset] = useState(0)
  const [data, setData] = useState<{ offset: number; guild: Guild } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const week = kstWeekRange(offset)

  useEffect(() => {
    const isLatest = latest()
    setError(null)
    const w = kstWeekRange(offset)
    fetchStats(w.from, w.to)
      .then((rows) => isLatest() && setData({ offset, guild: aggregateGuild(rows) }))
      .catch((e) => isLatest() && setError(errorMessage(e)))
  }, [offset, tick, latest])

  const g = data && data.offset === offset ? data.guild : null
  const sheetQuery = `period=custom&start=${kstDateString(week.from)}&end=${kstDateString(new Date(week.to.getTime() - 1))}`

  return (
    <section className="card" aria-labelledby="guild-week-title" style={{ marginBottom: 14 }}>
      <div className="card__head" style={{ flexWrap: 'wrap' }}>
        <h2 className="card__title" id="guild-week-title">
          길드 전체 주간 참여율
        </h2>
        <div className="row" role="group" aria-label="주 선택">
          <button type="button" className="btn btn--sm" onClick={() => setOffset((o) => o - 1)} aria-label="지난 주">
            ◀
          </button>
          <span className="small num" aria-live="polite" style={{ minWidth: 190, textAlign: 'center' }}>
            {week.label}
            {offset === 0 && ' (이번 주)'}
          </span>
          <button
            type="button"
            className="btn btn--sm"
            onClick={() => setOffset((o) => Math.min(0, o + 1))}
            disabled={offset >= 0}
            aria-label="다음 주"
          >
            ▶
          </button>
          {offset !== 0 && (
            <button type="button" className="btn btn--sm btn--ghost" onClick={() => setOffset(0)}>
              이번 주
            </button>
          )}
        </div>
      </div>

      {error && <ErrorNotice message={error} onRetry={() => setTick((t) => t + 1)} />}

      <div className="row" style={{ alignItems: 'flex-end', gap: 20, marginBottom: 12 }}>
        <div>
          <div className="stat__value" aria-busy={!g}>
            {g ? formatRate(g.total.attended, g.total.eligible) : '…'}
            {g && (
              <small>
                {g.total.attended}/{g.total.eligible}
              </small>
            )}
          </div>
          <div className="small muted">
            {g && g.total.eligible === 0
              ? '이 주에 등록된 보스 회차가 없습니다'
              : g
                ? `재적 길드원 ${g.members}명 중 ${g.attendingMembers}명 참여`
                : '계산 중…'}
          </div>
        </div>
      </div>

      <div className="table-wrap" style={{ maxHeight: 'none' }}>
        <table className="table">
          <caption className="sr-only">레벨별 길드 전체 주간 참여율</caption>
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
                const c = g?.levels[l]
                return (
                  <td key={l} style={{ textAlign: 'center' }} className={c?.eligible ? '' : 'cell--none'}>
                    <span className="cell__rate">{c ? formatRate(c.attended, c.eligible) : '…'}</span>
                    <span className="cell__count">{c ? `${c.attended}/${c.eligible}` : ''}</span>
                  </td>
                )
              })}
            </tr>
          </tbody>
        </table>
      </div>
      <p className="small muted" style={{ margin: '8px 0 0' }}>
        모든 길드원의 참여 횟수 합 ÷ 참여 가능 횟수 합(개인 참여율의 평균 아님). 가입 전·탈퇴 후·취소 회차 제외 · 등록된 보스 회차
        기준 · <a href={href(`/sheet?${sheetQuery}`)}>이 주 길드원별 참여율 보기 →</a>
      </p>
    </section>
  )
}
