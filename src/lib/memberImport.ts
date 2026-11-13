import { parseCsv, unescapeFormula } from './csv'
import { normalizeName } from './normalize'
import { fromKstInputValue, isValidDateString, kstDateToUtc } from './time'

export interface ImportRow {
  line: number
  nickname: string
  joinedAt: Date | null
  leftAt: Date | null
  aliases: string[]
  errors: string[]
  warnings: string[]
}

/** 'YYYY-MM-DD', 'YYYY-MM-DD HH:mm', 'YYYY-MM-DDTHH:mm' 은 KST 로, 오프셋이 있는 ISO 는 그대로 해석 */
export function parseKstDateTime(raw: string): Date | null {
  const v = raw.trim().replace(/\./g, '-').replace(/\//g, '-')
  if (!v) return null
  if (isValidDateString(v)) return kstDateToUtc(v)
  const local = fromKstInputValue(v.replace(' ', 'T'))
  if (local) return local
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(v)) {
    const d = new Date(v)
    return Number.isNaN(d.getTime()) ? null : d
  }
  return null
}

/** 줄바꿈으로 구분된 닉네임 목록 */
export function parseNicknameList(text: string, joinedAt: Date): ImportRow[] {
  return text
    .split(/\r?\n/)
    .map((l, i) => ({ l: l.normalize('NFC').trim(), i }))
    .filter(({ l }) => l !== '')
    .map(({ l, i }) => ({ line: i + 1, nickname: l, joinedAt, leftAt: null, aliases: [], errors: [], warnings: [] }))
}

const HEADER_ALIASES: Record<string, 'nickname' | 'joined' | 'left' | 'aliases'> = {
  nickname: 'nickname',
  닉네임: 'nickname',
  joined_at: 'joined',
  가입일: 'joined',
  가입일시: 'joined',
  left_at: 'left',
  탈퇴일: 'left',
  탈퇴일시: 'left',
  aliases: 'aliases',
  별칭: 'aliases',
}

/** CSV: 헤더 필수 (닉네임, 가입일, 탈퇴일, 별칭). 별칭은 | 로 구분 */
export function parseMemberCsv(text: string): { rows: ImportRow[]; error?: string } {
  const table = parseCsv(text)
  if (table.length === 0) return { rows: [], error: '내용이 없습니다.' }
  const header = table[0].map((h) => HEADER_ALIASES[h.trim().toLowerCase()] ?? HEADER_ALIASES[h.trim()])
  const col = (k: string) => header.indexOf(k as never)
  if (col('nickname') < 0) return { rows: [], error: '첫 줄에 "닉네임" 열이 필요합니다.' }
  const rows: ImportRow[] = []
  for (let i = 1; i < table.length; i++) {
    const r = table[i]
    const get = (k: string) => (col(k) >= 0 ? unescapeFormula((r[col(k)] ?? '').trim()) : '')
    const errors: string[] = []
    const nickname = get('nickname').normalize('NFC')
    const joinedRaw = get('joined')
    const leftRaw = get('left')
    const joinedAt = joinedRaw ? parseKstDateTime(joinedRaw) : null
    const leftAt = leftRaw ? parseKstDateTime(leftRaw) : null
    if (joinedRaw && !joinedAt) errors.push(`가입일 형식 오류: ${joinedRaw}`)
    if (!joinedRaw) errors.push('가입일이 비어 있습니다.')
    if (leftRaw && !leftAt) errors.push(`탈퇴일 형식 오류: ${leftRaw}`)
    rows.push({
      line: i + 1,
      nickname,
      joinedAt,
      leftAt,
      aliases: get('aliases')
        .split('|')
        .map((a) => a.normalize('NFC').trim())
        .filter(Boolean),
      errors,
      warnings: [],
    })
  }
  return { rows }
}

export interface ExistingName {
  key: string
  owner: string
}

/** 공통 검증: 빈 값, 길이, 날짜 순서, 파일 내 중복, 기존 명단/별칭과 충돌 */
export function validateImportRows(rows: ImportRow[], existing: ExistingName[]): ImportRow[] {
  const taken = new Map(existing.map((e) => [e.key, e.owner]))
  const seen = new Map<string, number>()
  return rows.map((row) => {
    const errors = [...row.errors]
    const key = normalizeName(row.nickname)
    if (!key) errors.push('닉네임이 비어 있습니다.')
    if ([...row.nickname].length > 40) errors.push('닉네임은 40자 이하여야 합니다.')
    if (row.joinedAt && row.leftAt && row.leftAt <= row.joinedAt) errors.push('탈퇴일은 가입일보다 늦어야 합니다.')
    if (key && taken.has(key)) errors.push(`이미 등록됨: ${taken.get(key)}`)
    if (key && seen.has(key)) errors.push(`${seen.get(key)}행과 중복`)
    if (key) seen.set(key, row.line)
    const aliasKeys = new Set<string>()
    for (const a of row.aliases) {
      const ak = normalizeName(a)
      if (ak === key) errors.push(`별칭 "${a}"이(가) 닉네임과 같습니다.`)
      else if (taken.has(ak)) errors.push(`별칭 "${a}"은(는) 이미 ${taken.get(ak)}에 사용 중`)
      else if (seen.has(ak) || aliasKeys.has(ak)) errors.push(`별칭 "${a}" 중복`)
      aliasKeys.add(ak)
    }
    for (const ak of aliasKeys) seen.set(ak, row.line)
    return { ...row, errors }
  })
}
