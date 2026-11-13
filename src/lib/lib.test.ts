import { describe, expect, it } from 'vitest'
import { escapeFormula, parseCsv, toCsv, unescapeFormula } from './csv'
import { parseKstDateTime, parseMemberCsv, parseNicknameList, validateImportRows } from './memberImport'
import { aggregateGuild, aggregateStats, formatRate } from './stats'
import {
  formatKst,
  fromKstInputValue,
  kstDayRange,
  kstWeekRange,
  kstMonthStart,
  kstWeekStart,
  resolvePeriod,
  toKstInputValue,
} from './time'

describe('참여율 표시', () => {
  it('3/4 = 75.0%, 분모 0 = —, 소수점 한 자리', () => {
    expect(formatRate(3, 4)).toBe('75.0%')
    expect(formatRate(0, 0)).toBe('—')
    expect(formatRate(0, 5)).toBe('0.0%')
    expect(formatRate(2, 3)).toBe('66.7%')
    expect(formatRate(1, 3)).toBe('33.3%')
    expect(formatRate(4, 4)).toBe('100.0%')
  })

  it('전체 참여율은 레벨별 퍼센트의 평균이 아니라 횟수 합으로 계산한다', () => {
    const s = aggregateStats([
      { member_id: 'm', boss_level: 40, eligible: 1, attended: 1 }, // 100%
      { member_id: 'm', boss_level: 50, eligible: 9, attended: 0 }, // 0%
    ]).get('m')!
    expect(s.total).toEqual({ attended: 1, eligible: 10 })
    expect(formatRate(s.total.attended, s.total.eligible)).toBe('10.0%') // 단순 평균이면 50.0%
    expect(s.levels[85]).toEqual({ attended: 0, eligible: 0 })
  })

  it('길드 전체 참여율은 모든 길드원의 횟수 합으로 계산한다 (개인 참여율 평균 아님)', () => {
    // A: 2회 중 2회(100%), B: 2회 중 0회(0%), C: 가입 전이라 참여 가능 0회 → 행 없음
    // D: 50레벨 8회 중 2회(25%)
    const g = aggregateGuild([
      { member_id: 'A', boss_level: 50, eligible: 2, attended: 2 },
      { member_id: 'B', boss_level: 50, eligible: 2, attended: 0 },
      { member_id: 'D', boss_level: 50, eligible: 8, attended: 2 },
    ])
    expect(g.total).toEqual({ attended: 4, eligible: 12 })
    expect(formatRate(g.total.attended, g.total.eligible)).toBe('33.3%') // 개인 평균이면 41.7%
    expect(g.levels[50]).toEqual({ attended: 4, eligible: 12 })
    expect(g.members).toBe(3)
    expect(g.attendingMembers).toBe(2)
    expect(formatRate(aggregateGuild([]).total.attended, aggregateGuild([]).total.eligible)).toBe('—')
  })
})

describe('한국 시각', () => {
  it('KST 자정 경계를 UTC로 정확히 바꾼다', () => {
    const r = kstDayRange('2026-01-01')
    expect(r.from.toISOString()).toBe('2025-12-31T15:00:00.000Z')
    expect(r.to.toISOString()).toBe('2026-01-01T15:00:00.000Z')
  })
  it('UTC로는 전날이어도 KST 날짜로 표시한다', () => {
    expect(formatKst('2026-11-12T15:30:00Z')).toBe('2026-11-13(금) 00:30')
  })
  it('이번 주는 KST 월요일 00:00, 이번 달은 1일 00:00부터', () => {
    // 2026-11-15(일) 23:30 KST
    const sunNight = new Date('2026-11-15T14:30:00Z')
    expect(kstWeekStart(sunNight).toISOString()).toBe('2026-11-08T15:00:00.000Z') // 11-09(월) 00:00 KST
    // 2026-11-16(월) 00:10 KST → 그날 00:00
    expect(kstWeekStart(new Date('2026-11-15T15:10:00Z')).toISOString()).toBe('2026-11-15T15:00:00.000Z')
    // UTC로는 10월 31일이지만 KST로는 11월 1일
    expect(kstMonthStart(new Date('2026-10-31T16:00:00Z')).toISOString()).toBe('2026-10-31T15:00:00.000Z')
  })
  it('datetime-local 값은 KST로 해석한다', () => {
    expect(fromKstInputValue('2026-11-13T21:05')!.toISOString()).toBe('2026-11-13T12:05:00.000Z')
    expect(toKstInputValue(new Date('2026-11-13T12:05:00Z'))).toBe('2026-11-13T21:05')
    expect(fromKstInputValue('2026-02-30T10:00')).toBeNull()
    expect(fromKstInputValue('')).toBeNull()
  })
  it('주간 범위는 KST 월요일 00:00 ~ 일요일 23:59:59 (다음 월요일 00:00 미만)', () => {
    const now = new Date('2026-11-15T14:59:59Z') // 일요일 23:59:59 KST
    const w = kstWeekRange(0, now)
    expect(w.from.toISOString()).toBe('2026-11-08T15:00:00.000Z') // 11-09(월) 00:00 KST
    expect(w.to.toISOString()).toBe('2026-11-15T15:00:00.000Z') // 11-16(월) 00:00 KST
    expect(w.label).toBe('2026-11-09(월) ~ 2026-11-15(일)')
    const prev = kstWeekRange(-1, now)
    expect(prev.to.toISOString()).toBe(w.from.toISOString())
    // 월요일 00:00 KST 가 되면 새 주
    expect(kstWeekRange(0, new Date('2026-11-15T15:00:00Z')).from.toISOString()).toBe('2026-11-15T15:00:00.000Z')
  })

  it('이번 주/이번 달은 끝을 자르지 않아 방금(현재+몇 분) 저장한 회차도 포함한다', () => {
    const now = new Date('2026-11-13T10:39:00Z') // 19:39 KST
    for (const kind of ['week', 'month'] as const) {
      const p = resolvePeriod({ kind }, now)
      expect(p.to).toBeNull()
      expect(p.from!.getTime()).toBeLessThan(now.getTime())
    }
  })

  it('직접 지정 기간은 종료일 다음날 00:00 미만까지', () => {
    const p = resolvePeriod({ kind: 'custom', start: '2026-11-01', end: '2026-11-13' })
    expect(p.valid).toBe(true)
    expect(p.from!.toISOString()).toBe('2026-10-31T15:00:00.000Z')
    expect(p.to!.toISOString()).toBe('2026-11-13T15:00:00.000Z')
    expect(resolvePeriod({ kind: 'custom', start: '2026-11-13', end: '2026-11-01' }).valid).toBe(false)
  })
})

describe('CSV', () => {
  it('수식으로 해석될 값은 앞에 작은따옴표를 붙인다', () => {
    expect(escapeFormula('=SUM(A1)')).toBe("'=SUM(A1)")
    expect(escapeFormula('+82')).toBe("'+82")
    expect(escapeFormula('-1')).toBe("'-1")
    expect(escapeFormula('@cmd')).toBe("'@cmd")
    expect(escapeFormula('별빛')).toBe('별빛')
    expect(unescapeFormula("'=SUM(A1)")).toBe('=SUM(A1)')
  })
  it('한글·쉼표·따옴표·줄바꿈을 왕복 보존한다', () => {
    const rows = [
      ['닉네임', '메모'],
      ['별빛,하나', '그는 "최고"'],
      ['줄\n바꿈', '=위험'],
    ]
    const csv = toCsv(rows)
    expect(csv).toContain('"별빛,하나"')
    expect(csv).toContain('"그는 ""최고"""')
    const back = parseCsv('﻿' + csv)
    expect(back[1]).toEqual(['별빛,하나', '그는 "최고"'])
    expect(back[2]).toEqual(['줄\n바꿈', "'=위험"])
  })
  it('숫자는 이스케이프하지 않는다', () => {
    expect(toCsv([[-1, 3]])).toBe('-1,3')
  })
})

describe('명단 가져오기', () => {
  const existing = [
    { key: '기존회원', owner: '기존회원' },
    { key: '기존별칭', owner: '누군가(별칭)' },
  ]
  it('줄바꿈 목록을 읽고 중복과 기존 명단 충돌을 알려준다', () => {
    const at = new Date('2026-01-01T00:00:00Z')
    const rows = validateImportRows(parseNicknameList('새회원\n\n 기존회원 \n새회원\n기존별칭\n', at), existing)
    expect(rows.map((r) => r.nickname)).toEqual(['새회원', '기존회원', '새회원', '기존별칭'])
    expect(rows[0].errors).toEqual([])
    expect(rows[1].errors[0]).toContain('이미 등록됨')
    expect(rows[2].errors[0]).toContain('1행과 중복')
    expect(rows[3].errors[0]).toContain('이미 등록됨')
  })
  it('CSV 머리글·날짜·별칭을 해석하고 오류 행을 표시한다', () => {
    const csv = '﻿닉네임,가입일,탈퇴일,별칭\n별빛,2026-01-01,,별1|별2\n달빛,2026/02/30,,\n해,2026-03-01 10:00,2026-02-01,\n'
    const { rows, error } = parseMemberCsv(csv)
    expect(error).toBeUndefined()
    const checked = validateImportRows(rows, [])
    expect(checked[0].errors).toEqual([])
    expect(checked[0].aliases).toEqual(['별1', '별2'])
    expect(checked[0].joinedAt!.toISOString()).toBe('2025-12-31T15:00:00.000Z')
    expect(checked[1].errors.join()).toContain('가입일 형식 오류')
    expect(checked[2].errors.join()).toContain('탈퇴일은 가입일보다 늦어야')
  })
  it('닉네임 열이 없으면 거부한다', () => {
    expect(parseMemberCsv('이름,가입일\n a,2026-01-01').error).toContain('닉네임')
  })
  it('날짜 형식', () => {
    expect(parseKstDateTime('2026-11-13 21:00')!.toISOString()).toBe('2026-11-13T12:00:00.000Z')
    expect(parseKstDateTime('2026-11-13T12:00:00Z')!.toISOString()).toBe('2026-11-13T12:00:00.000Z')
    expect(parseKstDateTime('어제')).toBeNull()
  })
})
