import { describe, expect, it } from 'vitest'
import { buildRosterIndex, confidentSuggestion, finalAttendees, matchNameTag } from './matching'
import { plainSimilarity, similarity } from './similarity'
import { detectNameTags, NAME_TAG_PROFILES, otsuThreshold, rgbToHsv } from './nameTags'

const BLUE = NAME_TAG_PROFILES.find((p) => p.id === 'blue')!.rule
const GREEN = NAME_TAG_PROFILES.find((p) => p.id === 'green')!.rule

/** 단색 배경 위에 사각형들을 칠한 RGBA 이미지 */
function image(w: number, h: number, bg: [number, number, number]) {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < w * h; i++) data.set([...bg, 255], i * 4)
  const rect = (x: number, y: number, rw: number, rh: number, c: [number, number, number]) => {
    for (let yy = y; yy < y + rh; yy++) for (let xx = x; xx < x + rw; xx++) data.set([...c, 255], (yy * w + xx) * 4)
  }
  return { data, rect }
}

// 실제 캡처에서 잰 색
const NAME_FILL: [number, number, number] = [132, 156, 214] // 연한 남색 글자
const OUTLINE: [number, number, number] = [28, 34, 60] // 진한 외곽선
const GROUND: [number, number, number] = [92, 80, 66] // 흙바닥
const BEAM: [number, number, number] = [150, 205, 240] // 빛기둥(외곽선 없음)

/** 외곽선이 있는 "글자 획" 몇 개로 이름표 흉내 */
function drawTag(rect: (x: number, y: number, w: number, h: number, c: [number, number, number]) => void, x: number, y: number, fill = NAME_FILL) {
  for (let k = 0; k < 3; k++) {
    rect(x + k * 16 - 1, y - 1, 12, 18, OUTLINE)
    rect(x + k * 16, y, 3, 16, fill)
    rect(x + k * 16 + 3, y + 6, 7, 3, fill)
  }
}

describe('이름표 찾기', () => {
  it('측정한 이름표 색은 파란 이름 범위에 들고, 빛기둥 색은 들지 않는다', () => {
    const [h, s, v] = rgbToHsv(...NAME_FILL)
    expect(h).toBeGreaterThanOrEqual(BLUE.h[0])
    expect(h).toBeLessThanOrEqual(BLUE.h[1])
    expect(s).toBeGreaterThanOrEqual(BLUE.s[0])
    expect(v).toBeGreaterThanOrEqual(BLUE.v)
    const beam = rgbToHsv(...BEAM)
    expect(beam[0] < BLUE.h[0] || beam[1] < BLUE.s[0]).toBe(true)
  })

  it('외곽선 있는 파란 글자만 이름표로 잡고, 외곽선 없는 큰 색 덩어리는 버린다', () => {
    const W = 300
    const H = 120
    const { data, rect } = image(W, H, GROUND)
    drawTag(rect, 30, 20) // 이름표
    rect(180, 10, 60, 100, NAME_FILL) // 같은 색이지만 외곽선 없는 큰 덩어리 (하늘·이펙트)
    const { boxes } = detectNameTags(data, W, H, BLUE)
    expect(boxes).toHaveLength(1)
    // 상자는 글자 사이를 잇는 가로 팽창(±6px)만큼 넓게 잡힌다
    expect(boxes[0].x).toBeGreaterThanOrEqual(20)
    expect(boxes[0].x).toBeLessThanOrEqual(32)
    expect(boxes[0].w).toBeGreaterThan(35)
    expect(boxes[0].h).toBeLessThanOrEqual(22)
  })

  it('초록 이름은 초록 범위로 찾는다', () => {
    const W = 200
    const H = 80
    const { data, rect } = image(W, H, GROUND)
    drawTag(rect, 40, 30, [96, 150, 100])
    expect(detectNameTags(data, W, H, GREEN).boxes).toHaveLength(1)
    expect(detectNameTags(data, W, H, BLUE).boxes).toHaveLength(0)
  })

  it('Otsu 임계값은 두 무리를 가른다', () => {
    const vals = [...new Array(50).fill(30), ...new Array(50).fill(220)]
    const th = otsuThreshold(vals)
    expect(th).toBeGreaterThanOrEqual(30)
    expect(th).toBeLessThan(220)
  })
})

describe('OCR 오류를 고려한 유사도', () => {
  it('받침 빠짐·비슷한 글자 바뀜은 덜 감점한다', () => {
    expect(similarity('쿠츠', '쿤츠')).toBeGreaterThan(plainSimilarity('쿠츠', '쿤츠'))
    expect(similarity('포즈', '폭주')).toBeGreaterThanOrEqual(0.8)
    expect(similarity('구순표', '구준표')).toBeGreaterThanOrEqual(0.9)
  })
  it('관련 없는 이름은 여전히 낮다', () => {
    expect(similarity('모드', '길동')).toBeLessThan(0.6)
    expect(similarity('그랑', '구준표')).toBeLessThan(0.4)
    expect(similarity('같다', '같다')).toBe(1)
  })
})

describe('이름표 대조 (실제 캡처에서 읽힌 값)', () => {
  const roster = ['길드원', '지각', '구준표', '쿤츠', '폭주', '그랑', '구준희', '군자'].map((n, i) => ({
    id: `m${i}`,
    nickname: n,
    aliases: [],
  }))
  const index = buildRosterIndex(roster)
  const box = { x: 0, y: 0, w: 50, h: 20 }
  const tag = (...texts: string[]) => ({ box, reads: texts.map((text) => ({ text, confidence: 80 })) })
  const m = (t: ReturnType<typeof tag>, k = 'k') => matchNameTag(index, t, { sourceId: 's', key: k })

  it('여러 전처리에서 같은 이름이 2번 이상 나오면 정확 일치로 자동 선택', () => {
    const r = m(tag('구준표', '구준표', '구준표', '규준묘'))!
    expect(r.status).toBe('exact')
    expect(r.memberId).toBe('m2')
    expect(r.selected).toBe(true)
    expect(r.bbox).toEqual(box)
  })

  it('한 번만 정확히 읽히면 자동 확정하지 않는다', () => {
    const r = m(tag('구준표', '구순표', '규춘표'))!
    expect(r.status).toBe('review')
    expect(r.memberId).toBeNull()
    expect(r.suggestions[0].memberId).toBe('m2')
  })

  it('오인식(군츠/쿠츠)은 확인 필요로, 비슷한 다른 이름(군자)보다 쿤츠를 먼저 추천', () => {
    const r = m(tag('군츠', '군츠', '쿠츠', '쿠츠'))!
    expect(r.status).toBe('review')
    expect(r.suggestions[0].nickname).toBe('쿤츠')
  })

  // 아래 읽기 값은 실제 붙여넣은 캡처(2340×1080)에서 나온 것
  it('빛기둥 위 이름(일드원/치드원/이드 이 [ 그 뇌)은 길드원을 뚜렷한 1순위로 추천', () => {
    const r = m(tag('일드원', '치드원', '이드 이 [ 그 뇌', '드원'))!
    expect(r.status).toBe('review')
    expect(r.suggestions[0].nickname).toBe('길드원')
    expect(confidentSuggestion(r)?.nickname).toBe('길드원')
  })

  it('받침이 빠진 읽기(쿠츠, 포즈 7)도 올바른 이름을 1순위로, 비슷한 다른 이름(쿠키·폭풍)보다 높게', () => {
    const idx2 = buildRosterIndex([...roster, { id: 'x1', nickname: '쿠키', aliases: [] }, { id: 'x2', nickname: '폭풍', aliases: [] }])
    const kunz = matchNameTag(idx2, tag('쿠츠', '쿠츠', '쿠츠'), { sourceId: 's', key: 'a' })!
    expect(kunz.status).toBe('review')
    expect(kunz.suggestions[0].nickname).toBe('쿤츠')
    const pok = matchNameTag(idx2, tag('포즈 7,', '푸즈 11', '포즈 -', '포즈 고'), { sourceId: 's', key: 'b' })!
    expect(pok.suggestions[0].nickname).toBe('폭주')
    expect(pok.suggestions[0].score).toBeGreaterThan(pok.suggestions[1]?.score ?? 0)
    expect(pok.raw).toBe('포즈')
  })

  it('UI 문구(AI 모드 실행 중...)는 여러 번 읽혀도 미등록으로 올리지 않는다', () => {
    expect(m(tag('시 모드 실행 중...', '시] 모드 실행 중...', '^^1 모드 실행 중. ..'))).toBeNull()
    expect(m(tag('안전!', '안전!'))).toBeNull()
  })

  it('추천 점수가 높아도 2순위와 비슷하면 일괄 적용 대상이 아니다', () => {
    const idx3 = buildRosterIndex([
      { id: 'a', nickname: '별빛하나', aliases: [] },
      { id: 'b', nickname: '별빛하니', aliases: [] },
    ])
    const r = matchNameTag(idx3, tag('별빛하녀', '별빛하녀'), { sourceId: 's', key: 'k' })!
    expect(r.status).toBe('review')
    expect(confidentSuggestion(r)).toBeNull()
  })

  it('UI 잡음(숫자, 한 글자, 매번 다른 글자)은 버린다', () => {
    expect(m(tag('10)2.000', '10,2.000', '0,2,.000', '102.000'))).toBeNull()
    expect(m(tag('개', '개', '기', '네'))).toBeNull()
    expect(m(tag('1)', '1)', '7', '64'))).toBeNull()
  })

  it('명단에 없지만 일관되게 읽힌 이름은 미등록으로 남긴다', () => {
    const r = m(tag('나그네', '나그네', '나그내'))!
    expect(r.status).toBe('unregistered')
    expect(r.raw).toBe('나그네')
  })

  it('같은 사람이 여러 이름표·이미지에서 잡혀도 한 번만 집계', () => {
    const a = m(tag('구준표', '구준표'), 'a')!
    const b = m(tag('구준표', '구준표', '구준표'), 'b')!
    const byId = new Map(roster.map((r) => [r.id, r]))
    expect(finalAttendees([a, b], [], byId).map((f) => [f.nickname, f.occurrences])).toEqual([['구준표', 2]])
  })
})
