import { describe, expect, it } from 'vitest'
import { buildRosterIndex, finalAttendees, matchNameTag } from './matching'
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

  it('빛기둥 위 이름(얼드퀸/합드린…)도 0.5 기준으로 추천 후보에 올린다', () => {
    const r = m(tag('얼드퀸', '<알드퀸', '합드린', '미드레'))!
    expect(r.status).toBe('review')
    expect(r.suggestions.map((s) => s.nickname)).toContain('길드원')
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
