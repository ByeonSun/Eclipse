// 닉네임 유사도 (0~1). 한글은 자모로 분해해 비교하므로 "별빛" vs "벌빛" 같은 OCR 오인식이
// 완전히 다른 글자로 취급되지 않는다. 이 점수는 "추천"에만 쓰고 자동 확정에는 쓰지 않는다.

const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ'
const JUNG = 'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ'
const JONG = ['', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ', 'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ']

export function toJamo(s: string): string[] {
  const out: string[] = []
  for (const ch of s) {
    const code = ch.codePointAt(0)!
    if (code >= 0xac00 && code <= 0xd7a3) {
      const idx = code - 0xac00
      out.push(CHO[Math.floor(idx / 588)], JUNG[Math.floor((idx % 588) / 28)])
      const jong = JONG[idx % 28]
      if (jong) out.push(jong)
    } else {
      out.push(ch)
    }
  }
  return out
}

export function levenshtein(a: string[], b: string[]): number {
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  let cur = new Array<number>(b.length + 1)
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
    }
    ;[prev, cur] = [cur, prev]
  }
  return prev[b.length]
}

/** 정규화된 두 문자열의 유사도 0~1 (단순 자모 편집 거리) */
export function plainSimilarity(a: string, b: string): number {
  if (a === b) return 1
  const ja = toJamo(a)
  const jb = toJamo(b)
  const max = Math.max(ja.length, jb.length)
  if (max === 0) return 1
  return 1 - levenshtein(ja, jb) / max
}

// ---------------------------------------------------------------------------
// OCR 오류를 고려한 유사도
// 실제 게임 캡처에서 반복된 오인식: 받침이 빠짐(쿤→쿠, 폭→포), 모양이 비슷한 자음·모음이 바뀜(준→순, ㅜ→ㅡ).
// 이런 차이는 비용을 낮게 매겨 올바른 길드원이 추천 1순위에 오도록 한다. (자동 확정에는 쓰지 않는다)
// ---------------------------------------------------------------------------
const GROUPS = ['ㄱㅋㄲ', 'ㅈㅊㅅㅆㅉ', 'ㄷㅌㄸ', 'ㅂㅍㅃ', 'ㅇㅎ', 'ㄴㄹ', 'ㅏㅑ', 'ㅓㅕ', 'ㅗㅛㅜㅠㅡ', 'ㅐㅔㅒㅖ', 'ㅣㅢ', 'ㅘㅝ', 'ㅙㅞㅚㅟ']
const GROUP_OF = new Map<string, number>()
GROUPS.forEach((g, i) => {
  for (const ch of g) GROUP_OF.set(ch, i)
})

/** 자모를 위치(초성 C, 중성 V, 종성 F, 기타 X)와 함께 */
function ocrTokens(s: string): string[] {
  const out: string[] = []
  for (const ch of s) {
    const code = ch.codePointAt(0)!
    if (code >= 0xac00 && code <= 0xd7a3) {
      const idx = code - 0xac00
      out.push('C' + CHO[Math.floor(idx / 588)], 'V' + JUNG[Math.floor((idx % 588) / 28)])
      const jong = JONG[idx % 28]
      if (jong) out.push('F' + jong)
    } else {
      out.push('X' + ch)
    }
  }
  return out
}

const FINAL_INDEL = 0.4
const LOOKALIKE_SUB = 0.5

function subCost(a: string, b: string): number {
  if (a === b) return 0
  if (a[0] !== b[0]) return 1
  const ga = GROUP_OF.get(a.slice(1))
  return ga !== undefined && ga === GROUP_OF.get(b.slice(1)) ? LOOKALIKE_SUB : 1
}

const indelCost = (t: string) => (t[0] === 'F' ? FINAL_INDEL : 1)

/** 정규화된 두 문자열의 OCR 유사도 0~1 */
export function similarity(a: string, b: string): number {
  if (a === b) return 1
  const x = ocrTokens(a)
  const y = ocrTokens(b)
  const max = Math.max(x.length, y.length)
  if (max === 0) return 1
  let prev = new Array<number>(y.length + 1)
  prev[0] = 0
  for (let j = 1; j <= y.length; j++) prev[j] = prev[j - 1] + indelCost(y[j - 1])
  for (let i = 1; i <= x.length; i++) {
    const cur = new Array<number>(y.length + 1)
    cur[0] = prev[0] + indelCost(x[i - 1])
    for (let j = 1; j <= y.length; j++) {
      cur[j] = Math.min(prev[j] + indelCost(x[i - 1]), cur[j - 1] + indelCost(y[j - 1]), prev[j - 1] + subCost(x[i - 1], y[j - 1]))
    }
    prev = cur
  }
  return Math.max(0, 1 - prev[y.length] / max)
}
