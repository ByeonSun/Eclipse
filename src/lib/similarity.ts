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

/** 정규화된 두 문자열의 유사도 0~1 */
export function similarity(a: string, b: string): number {
  if (a === b) return 1
  const ja = toJamo(a)
  const jb = toJamo(b)
  const max = Math.max(ja.length, jb.length)
  if (max === 0) return 1
  return 1 - levenshtein(ja, jb) / max
}
