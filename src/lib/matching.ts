import { cleanOcrLine, normalizeName } from './normalize'
import { similarity } from './similarity'

export type MatchStatus = 'exact' | 'alias' | 'review' | 'unregistered' | 'excluded'

export const STATUS_LABEL: Record<MatchStatus, string> = {
  exact: '정확 일치',
  alias: '별칭 일치',
  review: '확인 필요',
  unregistered: '미등록',
  excluded: '제외',
}

export interface RosterMember {
  id: string
  nickname: string
  aliases: string[]
  /** 표시용 */
  archived?: boolean
}

export interface Suggestion {
  memberId: string
  nickname: string
  /** 닉네임 유사도 (OCR 신뢰도와 별개) */
  score: number
  via: string
}

export interface OcrToken {
  text: string
  /** OCR 엔진이 준 신뢰도 0~100 */
  confidence: number | null
}

export interface MatchItem {
  key: string
  sourceId: string
  raw: string
  cleaned: string
  ocrConfidence: number | null
  status: MatchStatus
  /** 판정 당시 상태 (제외 해제 시 복원용) */
  originalStatus: MatchStatus
  memberId: string | null
  suggestions: Suggestion[]
  /** 정확/별칭 일치였지만 정규화 키가 여러 사람에게 걸려 자동 매칭을 막은 경우 */
  conflict: string | null
  selected: boolean
}

interface IndexEntry {
  memberId: string
  via: 'nickname' | 'alias'
  text: string
}

export interface RosterIndex {
  byKey: Map<string, IndexEntry[]>
  members: Map<string, RosterMember>
  all: { key: string; entry: IndexEntry }[]
}

export function buildRosterIndex(members: RosterMember[]): RosterIndex {
  const byKey = new Map<string, IndexEntry[]>()
  const all: { key: string; entry: IndexEntry }[] = []
  const map = new Map<string, RosterMember>()
  const add = (key: string, entry: IndexEntry) => {
    if (!key) return
    const list = byKey.get(key) ?? []
    if (!list.some((e) => e.memberId === entry.memberId && e.via === entry.via)) list.push(entry)
    byKey.set(key, list)
    all.push({ key, entry })
  }
  for (const m of members) {
    map.set(m.id, m)
    add(normalizeName(m.nickname), { memberId: m.id, via: 'nickname', text: m.nickname })
    for (const a of m.aliases) add(normalizeName(a), { memberId: m.id, via: 'alias', text: a })
  }
  return { byKey, members: map, all }
}

export const SUGGEST_THRESHOLD = 0.6

export function suggest(index: RosterIndex, key: string, limit = 3): Suggestion[] {
  const best = new Map<string, Suggestion>()
  for (const { key: k, entry } of index.all) {
    const score = similarity(key, k)
    if (score < SUGGEST_THRESHOLD) continue
    const prev = best.get(entry.memberId)
    if (!prev || score > prev.score) {
      best.set(entry.memberId, {
        memberId: entry.memberId,
        nickname: index.members.get(entry.memberId)?.nickname ?? entry.text,
        score,
        via: entry.via === 'alias' ? `별칭 "${entry.text}"` : '닉네임',
      })
    }
  }
  return [...best.values()].sort((a, b) => b.score - a.score || a.nickname.localeCompare(b.nickname, 'ko')).slice(0, limit)
}

/** 하나의 텍스트를 명단과 대조 */
export function matchText(
  index: RosterIndex,
  raw: string,
  opts: { sourceId: string; key: string; confidence?: number | null },
): MatchItem {
  const cleaned = cleanOcrLine(raw)
  const key = normalizeName(cleaned)
  const base = {
    key: opts.key,
    sourceId: opts.sourceId,
    raw,
    cleaned,
    ocrConfidence: opts.confidence ?? null,
    conflict: null as string | null,
  }
  const hits = index.byKey.get(key) ?? []
  const people = [...new Set(hits.map((h) => h.memberId))]

  if (people.length > 1) {
    // 같은 정규화 키가 여러 사람에게 걸려 있으면 자동 매칭하지 않는다.
    const names = people.map((id) => index.members.get(id)?.nickname ?? id).join(', ')
    return {
      ...base,
      status: 'review',
      originalStatus: 'review',
      memberId: null,
      suggestions: people.map((id) => ({
        memberId: id,
        nickname: index.members.get(id)?.nickname ?? id,
        score: 1,
        via: '충돌',
      })),
      conflict: `여러 길드원과 일치: ${names}`,
      selected: false,
    }
  }
  if (people.length === 1) {
    const exact = hits.some((h) => h.via === 'nickname')
    const status: MatchStatus = exact ? 'exact' : 'alias'
    return { ...base, status, originalStatus: status, memberId: people[0], suggestions: [], selected: true }
  }
  const suggestions = key ? suggest(index, key) : []
  const status: MatchStatus = suggestions.length ? 'review' : 'unregistered'
  // 유사도 결과는 자동 확정하지 않는다: memberId 는 비우고 selected=false.
  return { ...base, status, originalStatus: status, memberId: null, suggestions, selected: false }
}

const MIN_TOKEN_LEN = 2
const isConfident = (m: MatchItem) => m.status === 'exact' || m.status === 'alias' || !!m.conflict
const bestScore = (m: MatchItem) => m.suggestions[0]?.score ?? 0

/** 한 칸(열) 안에서 시도할 후보: 칸 전체 + 연속 단어 묶음(최대 3단어). 내부 공백이 있는 닉네임도 그대로 시도된다. */
function cellCandidates(cell: string): string[] {
  const words = cell.split(' ').filter(Boolean)
  const out = new Set<string>([cell])
  for (let size = Math.min(3, words.length); size >= 1; size--) {
    for (let i = 0; i + size <= words.length; i++) out.add(words.slice(i, i + size).join(' '))
  }
  return [...out].filter((c) => [...c].length >= MIN_TOKEN_LEN)
}

/**
 * OCR 줄 목록을 대조한다.
 *  1) 줄 전체가 닉네임/별칭과 일치하면 그대로 사용
 *  2) 넓은 공백(2칸 이상)·탭·세로줄로 열을 나눈 뒤, 각 열에서 일치하는 닉네임/별칭을 찾음
 *  3) 일치가 없으면 열마다 가장 비슷한 후보가 있는 조각을 "확인 필요"로 남김 (자동 확정 안 함)
 *  4) 그래도 없으면 줄 전체를 "미등록"으로 남겨 관리자가 볼 수 있게 함
 */
export function matchOcrLines(index: RosterIndex, lines: OcrToken[], sourceId: string): MatchItem[] {
  const out: MatchItem[] = []
  let n = 0
  const make = (text: string, conf: number | null) => matchText(index, text, { sourceId, key: `${sourceId}:${n++}`, confidence: conf })

  for (const line of lines) {
    const cleaned = cleanOcrLine(line.text)
    if (!cleaned) continue
    const whole = make(line.text, line.confidence)
    if (isConfident(whole)) {
      out.push(whole)
      continue
    }

    const cells = line.text
      .split(/\s{2,}|\t|[|¦│┃]/)
      .map(cleanOcrLine)
      .filter((c) => [...c].length >= MIN_TOKEN_LEN)

    const confident: MatchItem[] = []
    const review: MatchItem[] = []
    for (const cell of cells) {
      const tries = cellCandidates(cell).map((c) => make(c, line.confidence))
      const hit = tries.filter(isConfident)
      if (hit.length) {
        confident.push(...hit)
        continue
      }
      const best = tries.filter((t) => t.suggestions.length).sort((a, b) => bestScore(b) - bestScore(a))[0]
      if (best) review.push(best)
    }

    if (confident.length) {
      const seen = new Set<string>()
      for (const c of confident) {
        const id = c.memberId ?? c.key
        if (seen.has(id)) continue
        seen.add(id)
        out.push(c)
      }
      // 같은 줄의 다른 열에 비슷한 이름이 있으면 그것도 확인 대상으로 남긴다
      for (const r of review) if (!r.suggestions.some((s) => seen.has(s.memberId))) out.push(r)
      continue
    }
    if (review.length) {
      out.push(...review)
      continue
    }
    if ([...cleaned].length < MIN_TOKEN_LEN) continue
    out.push(whole)
  }
  return out
}

export interface FinalAttendee {
  memberId: string
  nickname: string
  matchMethod: 'exact' | 'alias' | 'manual'
  /** 몇 개의 OCR 항목에서 발견되었는지 (중복 제거 전) */
  occurrences: number
}

/**
 * 최종 참여자 = 선택된 OCR 항목 + 수동 추가. member_id 기준으로 중복을 제거한다.
 * 확인 필요 항목을 관리자가 연결한 경우 match_method 는 manual.
 */
export function finalAttendees(
  items: MatchItem[],
  manual: string[],
  roster: Map<string, RosterMember>,
): FinalAttendee[] {
  const out = new Map<string, FinalAttendee>()
  const rank = { exact: 0, alias: 1, manual: 2 } as const
  const push = (memberId: string, method: FinalAttendee['matchMethod']) => {
    const m = roster.get(memberId)
    if (!m) return
    const prev = out.get(memberId)
    if (prev) {
      prev.occurrences += 1
      if (rank[method] < rank[prev.matchMethod]) prev.matchMethod = method
    } else {
      out.set(memberId, { memberId, nickname: m.nickname, matchMethod: method, occurrences: 1 })
    }
  }
  for (const it of items) {
    if (!it.selected || !it.memberId || it.status === 'excluded') continue
    const method =
      it.status === 'exact' && it.originalStatus === 'exact'
        ? 'exact'
        : it.status === 'alias' && it.originalStatus === 'alias'
          ? 'alias'
          : 'manual'
    push(it.memberId, method)
  }
  for (const id of manual) push(id, 'manual')
  return [...out.values()].sort((a, b) => a.nickname.localeCompare(b.nickname, 'ko'))
}

/** 현재 닉네임·별칭 부분 검색 (임의 선택 없음, 후보만 반환) */
export function searchMembers<T extends RosterMember>(members: T[], query: string, limit = 20): T[] {
  const q = normalizeName(query)
  if (!q) return []
  const scored: { m: T; rank: number }[] = []
  for (const m of members) {
    const nick = normalizeName(m.nickname)
    let rank = -1
    if (nick === q) rank = 0
    else if (nick.startsWith(q)) rank = 1
    else if (nick.includes(q)) rank = 2
    else if (m.aliases.some((a) => normalizeName(a) === q)) rank = 3
    else if (m.aliases.some((a) => normalizeName(a).includes(q))) rank = 4
    if (rank >= 0) scored.push({ m, rank })
  }
  return scored
    .sort((a, b) => a.rank - b.rank || a.m.nickname.localeCompare(b.m.nickname, 'ko'))
    .slice(0, limit)
    .map((s) => s.m)
}
