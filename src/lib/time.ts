// 한국 시각(Asia/Seoul, UTC+9, 일광절약시간 없음) 유틸리티.
// 저장은 항상 UTC 기준 Date/ISO, 표시와 날짜 경계 계산만 KST 로 한다.

const KST_OFFSET_MS = 9 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

export interface KstParts {
  year: number
  month: number // 1-12
  day: number
  hour: number
  minute: number
  second: number
  weekday: number // 0=일 ~ 6=토
}

export function kstParts(d: Date): KstParts {
  const k = new Date(d.getTime() + KST_OFFSET_MS)
  return {
    year: k.getUTCFullYear(),
    month: k.getUTCMonth() + 1,
    day: k.getUTCDate(),
    hour: k.getUTCHours(),
    minute: k.getUTCMinutes(),
    second: k.getUTCSeconds(),
    weekday: k.getUTCDay(),
  }
}

const pad = (n: number) => String(n).padStart(2, '0')

/** 'YYYY-MM-DD' (KST 날짜) */
export function kstDateString(d: Date): string {
  const p = kstParts(d)
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

export function isValidDateString(s: string): boolean {
  const m = DATE_RE.exec(s)
  if (!m) return false
  const [y, mo, da] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const t = new Date(Date.UTC(y, mo - 1, da))
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === da
}

/** KST 날짜의 00:00 을 UTC Date 로 */
export function kstDateToUtc(date: string): Date {
  const m = DATE_RE.exec(date)
  if (!m || !isValidDateString(date)) throw new Error(`잘못된 날짜: ${date}`)
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - KST_OFFSET_MS)
}

/** KST 하루 [00:00, 다음날 00:00) */
export function kstDayRange(date: string): { from: Date; to: Date } {
  const from = kstDateToUtc(date)
  return { from, to: new Date(from.getTime() + DAY_MS) }
}

/** 시작일·종료일(모두 포함)을 [from, to) 로 */
export function kstDateSpan(start: string, end: string): { from: Date; to: Date } {
  return { from: kstDateToUtc(start), to: kstDayRange(end).to }
}

/** 이번 주 월요일 00:00 KST */
export function kstWeekStart(now: Date): Date {
  const p = kstParts(now)
  const sinceMonday = (p.weekday + 6) % 7
  const today = kstDateToUtc(`${p.year}-${pad(p.month)}-${pad(p.day)}`)
  return new Date(today.getTime() - sinceMonday * DAY_MS)
}

/**
 * 주간 범위: KST 월요일 00:00 ~ 다음 월요일 00:00 (= 월~일).
 * offset 0 = 이번 주, -1 = 지난 주.
 */
export function kstWeekRange(offset = 0, now: Date = new Date()): { from: Date; to: Date; label: string } {
  const from = new Date(kstWeekStart(now).getTime() + offset * 7 * DAY_MS)
  const to = new Date(from.getTime() + 7 * DAY_MS)
  const sunday = new Date(to.getTime() - DAY_MS)
  return { from, to, label: `${formatKst(from).slice(0, 13)} ~ ${formatKst(sunday).slice(0, 13)}` }
}

/** 이번 달 1일 00:00 KST */
export function kstMonthStart(now: Date): Date {
  const p = kstParts(now)
  return kstDateToUtc(`${p.year}-${pad(p.month)}-01`)
}

/** <input type="datetime-local"> 값 (KST) */
export function toKstInputValue(d: Date): string {
  const p = kstParts(d)
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`
}

/** datetime-local 값(KST로 해석)을 UTC Date 로. 잘못된 값이면 null */
export function fromKstInputValue(v: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(v)
  if (!m) return null
  const date = `${m[1]}-${m[2]}-${m[3]}`
  if (!isValidDateString(date)) return null
  const h = Number(m[4])
  const mi = Number(m[5])
  const s = Number(m[6] ?? 0)
  if (h > 23 || mi > 59 || s > 59) return null
  return new Date(kstDateToUtc(date).getTime() + ((h * 60 + mi) * 60 + s) * 1000)
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']

/** 2026-11-13(금) 21:05 */
export function formatKst(value: string | Date, opts: { seconds?: boolean; weekday?: boolean } = {}): string {
  const d = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(d.getTime())) return '-'
  const p = kstParts(d)
  const wd = opts.weekday === false ? '' : `(${WEEKDAYS[p.weekday]})`
  const sec = opts.seconds ? `:${pad(p.second)}` : ''
  return `${p.year}-${pad(p.month)}-${pad(p.day)}${wd} ${pad(p.hour)}:${pad(p.minute)}${sec}`
}

export function formatKstDate(value: string | Date): string {
  const d = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(d.getTime())) return '-'
  return kstDateString(d)
}

// ---------------------------------------------------------------------------
// 조회 기간
// ---------------------------------------------------------------------------
export type PeriodKind = 'week' | 'month' | 'all' | 'custom'
export interface Period {
  kind: PeriodKind
  start?: string // YYYY-MM-DD, custom 전용
  end?: string
}
export interface ResolvedPeriod {
  from: Date | null
  to: Date | null
  label: string
  valid: boolean
  error?: string
}

export function resolvePeriod(p: Period, now: Date = new Date()): ResolvedPeriod {
  switch (p.kind) {
    // 이번 주/이번 달은 시작 시각만 둔다. 저장은 현재+10분까지 허용하므로 끝을 "지금"으로 자르면
    // 방금 기록한 회차가 빠질 수 있다. 미래 회차는 저장 단계에서 막는다.
    case 'week': {
      const from = kstWeekStart(now)
      return { from, to: null, label: `이번 주 (${kstDateString(from)} ~ 오늘)`, valid: true }
    }
    case 'month': {
      const from = kstMonthStart(now)
      return { from, to: null, label: `이번 달 (${kstDateString(from)} ~ 오늘)`, valid: true }
    }
    case 'all':
      return { from: null, to: null, label: '전체 기간', valid: true }
    case 'custom': {
      if (!p.start || !p.end || !isValidDateString(p.start) || !isValidDateString(p.end)) {
        return { from: null, to: null, label: '직접 지정', valid: false, error: '시작일과 종료일을 입력하세요.' }
      }
      if (p.start > p.end) {
        return { from: null, to: null, label: '직접 지정', valid: false, error: '시작일이 종료일보다 늦습니다.' }
      }
      const span = kstDateSpan(p.start, p.end)
      return { ...span, label: `${p.start} ~ ${p.end}`, valid: true }
    }
  }
}

export function periodToQuery(p: Period): string {
  const q = new URLSearchParams({ period: p.kind })
  if (p.kind === 'custom') {
    if (p.start) q.set('start', p.start)
    if (p.end) q.set('end', p.end)
  }
  return q.toString()
}

export function periodFromQuery(q: URLSearchParams, fallback: PeriodKind = 'month'): Period {
  const kind = q.get('period') as PeriodKind | null
  if (kind === 'week' || kind === 'month' || kind === 'all') return { kind }
  if (kind === 'custom') return { kind, start: q.get('start') ?? undefined, end: q.get('end') ?? undefined }
  return { kind: fallback }
}
