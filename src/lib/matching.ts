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
  /** 이름표 모드: 원본 이미지에서 찾은 위치 */
  bbox?: { x: number; y: number; w: number; h: number }
  /** 이름표 모드: 여러 전처리로 읽은 글자들 */
  reads?: string[]
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

export function suggest(index: RosterIndex, key: string, limit = 3, threshold = SUGGEST_THRESHOLD): Suggestion[] {
  const best = new Map<string, Suggestion>()
  for (const { key: k, entry } of index.all) {
    const score = similarity(key, k)
    if (score < threshold) continue
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

// ---------------------------------------------------------------------------
// 이름표 모드
// ---------------------------------------------------------------------------
/** 이름표 추천 기준 (OCR 유사도). 추천일 뿐, 자동 확정은 아님 */
export const NAME_TAG_SUGGEST_THRESHOLD = 0.6
/** "추천 1순위 모두 적용" 대상: 이 점수 이상이고 2순위와 이만큼 차이 */
export const CONFIDENT_SUGGESTION = { score: 0.8, margin: 0.1 }

/** 한 줄 읽기에서 비교할 조각: 줄 전체 + 단어·연속 단어 (낱자모·기호뿐인 단어 제외) */
export function namePieces(norm: string): string[] {
  const words = norm.split(' ').filter((w) => /[가-힣a-z0-9]/i.test(w) && !/^[ㄱ-ㅎㅏ-ㅣ]+$/.test(w))
  const out = new Set<string>([norm])
  for (let size = Math.min(3, words.length); size >= 1; size--) {
    for (let i = 0; i + size <= words.length; i++) out.add(words.slice(i, i + size).join(' '))
  }
  return [...out]
}

/** 이름처럼 보이는가: 공백·기호 없이 2~16자 */
function looksLikeName(s: string): boolean {
  return /^[가-힣A-Za-z0-9_]{2,16}$/.test(s) && /[가-힣A-Za-z]/.test(s)
}

/** 확인 필요 항목 중 1순위 추천을 믿을 만한가 */
export function confidentSuggestion(item: MatchItem): Suggestion | null {
  const [first, second] = item.suggestions
  if (!first || item.conflict) return null
  if (first.score < CONFIDENT_SUGGESTION.score) return null
  if (second && first.score - second.score < CONFIDENT_SUGGESTION.margin) return null
  return first
}
/** 정확 일치로 인정하려면 서로 다른 전처리 결과 중 몇 개가 같은 이름이어야 하는지 */
export const NAME_TAG_EXACT_VOTES = 2

export interface NameTagInput {
  box: { x: number; y: number; w: number; h: number }
  reads: { text: string; confidence: number }[]
}

/**
 * 한 이름표를 여러 전처리로 읽은 결과를 명단과 대조한다.
 *  - 같은 길드원 이름(정확/별칭)이 2개 이상 전처리에서 나오고, 다른 길드원과 겹치지 않으면 → 정확/별칭 일치
 *  - 아니면 가장 비슷한 읽기로 추천 후보(유사도 0.5 이상) → 확인 필요
 *  - 추천이 없으면: 같은 글자가 2번 이상 읽힌 경우만 미등록으로 남기고, 나머지는 잡음으로 버린다(null)
 */
export function matchNameTag(index: RosterIndex, tag: NameTagInput, opts: { sourceId: string; key: string }): MatchItem | null {
  const reads = tag.reads.map((r) => ({ ...r, cleaned: cleanOcrLine(r.text), norm: normalizeName(cleanOcrLine(r.text)) })).filter((r) => r.norm)
  if (!reads.length) return null
  const bestConf = Math.max(...reads.map((r) => r.confidence))
  const base = {
    key: opts.key,
    sourceId: opts.sourceId,
    ocrConfidence: bestConf,
    conflict: null as string | null,
    bbox: tag.box,
    reads: [...new Set(reads.map((r) => r.cleaned))],
  }

  // 1) 투표: 각 읽기(또는 그 안의 단어)가 명단 이름과 정확히 같으면 한 표
  const votes = new Map<string, { count: number; via: 'nickname' | 'alias' }>()
  const conflicts: string[] = []
  for (const r of reads) {
    for (const piece of namePieces(r.norm)) {
      const hits = index.byKey.get(piece) ?? []
      const people = [...new Set(hits.map((h) => h.memberId))]
      if (people.length > 1) {
        conflicts.push(people.map((id) => index.members.get(id)?.nickname ?? id).join(', '))
        break
      }
      if (people.length === 1) {
        const prev = votes.get(people[0])
        const via = hits.some((h) => h.via === 'nickname') ? 'nickname' : 'alias'
        votes.set(people[0], { count: (prev?.count ?? 0) + 1, via: prev?.via === 'nickname' ? 'nickname' : via })
        break
      }
    }
  }
  const ranked = [...votes.entries()].sort((a, b) => b[1].count - a[1].count)
  if (ranked.length === 1 && ranked[0][1].count >= NAME_TAG_EXACT_VOTES && !conflicts.length) {
    const [memberId, v] = ranked[0]
    const status: MatchStatus = v.via === 'nickname' ? 'exact' : 'alias'
    const raw = index.members.get(memberId)?.nickname ?? reads[0].cleaned
    return { ...base, raw, cleaned: raw, status, originalStatus: status, memberId, suggestions: [], selected: true }
  }

  // 2) 추천
  const pool = new Map<string, Suggestion>()
  let bestScore = -1
  let bestPiece = reads[0].cleaned
  for (const r of reads) {
    for (const piece of namePieces(r.norm)) {
      for (const s of suggest(index, piece, 5, NAME_TAG_SUGGEST_THRESHOLD)) {
        const prev = pool.get(s.memberId)
        if (!prev || s.score > prev.score) pool.set(s.memberId, s)
        if (s.score > bestScore) {
          bestScore = s.score
          bestPiece = piece === r.norm ? r.cleaned : piece
        }
      }
    }
  }
  const suggestions = [...pool.values()].sort((a, b) => b.score - a.score).slice(0, 3)
  if (suggestions.length || conflicts.length) {
    return {
      ...base,
      raw: bestPiece,
      cleaned: bestPiece,
      status: 'review',
      originalStatus: 'review',
      memberId: null,
      suggestions,
      conflict: conflicts.length ? `여러 길드원과 일치: ${conflicts[0]}` : null,
      selected: false,
    }
  }

  // 3) 미등록 또는 잡음
  const counts = new Map<string, number>()
  for (const r of reads) counts.set(r.norm, (counts.get(r.norm) ?? 0) + 1)
  const [topNorm, topCount] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]
  const top = reads.find((r) => r.norm === topNorm)!
  // UI 문구("AI 모드 실행 중...")나 기호 섞인 조각은 이름이 아니므로 버린다
  const plausible = topCount >= 2 && looksLikeName(top.cleaned)
  if (!plausible) return null
  return {
    ...base,
    raw: top.cleaned,
    cleaned: top.cleaned,
    status: 'unregistered',
    originalStatus: 'unregistered',
    memberId: null,
    suggestions: [],
    selected: false,
  }
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
