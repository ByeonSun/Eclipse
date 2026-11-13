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

/**
 * 길드 전체 참여율 = 모든 길드원의 참여 횟수 합 ÷ 참여 가능 횟수 합.
 * (개인 참여율의 단순 평균이 아니다. 재적 기간 밖 회차는 개인 계산과 똑같이 분모에서 빠진다)
 */
export function aggregateGuild(rows: StatRow[]): MemberStats & { members: number; attendingMembers: number } {
  const s = emptyStats()
  const members = new Set<string>()
  const attending = new Set<string>()
  for (const r of rows) {
    const cell = s.levels[r.boss_level as BossLevel]
    if (!cell) continue
    cell.attended += r.attended
    cell.eligible += r.eligible
    s.total.attended += r.attended
    s.total.eligible += r.eligible
    if (r.eligible > 0) members.add(r.member_id)
    if (r.attended > 0) attending.add(r.member_id)
  }
  return { ...s, members: members.size, attendingMembers: attending.size }
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
