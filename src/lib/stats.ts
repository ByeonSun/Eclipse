import { BOSS_LEVELS, type BossLevel } from './constants'

/**
 * 참여율 표시. 분모가 0이면 "—".
 * 소수점 한 자리 (반올림).
 */
export function formatRate(attended: number, eligible: number): string {
  if (!eligible) return '—'
  const pct = Math.round((attended / eligible) * 1000) / 10
  return `${pct.toFixed(1)}%`
}

export function rateValue(attended: number, eligible: number): number | null {
  return eligible ? attended / eligible : null
}

export interface StatRow {
  member_id: string
  boss_level: number
  eligible: number
  attended: number
}

export interface Cell {
  attended: number
  eligible: number
}

export interface MemberStats {
  levels: Record<BossLevel, Cell>
  /** 전체 = 레벨별 횟수의 합 (퍼센트 평균이 아님) */
  total: Cell
}

export function emptyStats(): MemberStats {
  const levels = {} as Record<BossLevel, Cell>
  for (const l of BOSS_LEVELS) levels[l] = { attended: 0, eligible: 0 }
  return { levels, total: { attended: 0, eligible: 0 } }
}

export function aggregateStats(rows: StatRow[]): Map<string, MemberStats> {
  const out = new Map<string, MemberStats>()
  for (const r of rows) {
    let s = out.get(r.member_id)
    if (!s) {
      s = emptyStats()
      out.set(r.member_id, s)
    }
    const cell = s.levels[r.boss_level as BossLevel]
    if (!cell) continue
    cell.attended += r.attended
    cell.eligible += r.eligible
    s.total.attended += r.attended
    s.total.eligible += r.eligible
  }
  return out
}
