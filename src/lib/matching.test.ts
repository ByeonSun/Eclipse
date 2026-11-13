import { describe, expect, it } from 'vitest'
import { buildRosterIndex, finalAttendees, matchOcrLines, matchText, searchMembers, type RosterMember } from './matching'
import { cleanOcrLine, normalizeName } from './normalize'
import { similarity } from './similarity'

const roster: RosterMember[] = [
  { id: 'a', nickname: '별빛하나', aliases: ['별빛1'] },
  { id: 'b', nickname: '별빛하니', aliases: [] },
  { id: 'c', nickname: 'Moon Light', aliases: [] },
  { id: 'd', nickname: '검은달_77', aliases: [] },
  { id: 'e', nickname: '하이', aliases: [] },
]
const index = buildRosterIndex(roster)
const byId = new Map(roster.map((m) => [m.id, m]))

describe('정규화', () => {
  it('NFC, 앞뒤 공백, 연속 공백만 정리하고 숫자·특수문자·내부 공백은 유지한다', () => {
    const decomposed = '별빛하나'.normalize('NFD')
    expect(normalizeName(`  ${decomposed}\n`)).toBe('별빛하나')
    expect(normalizeName('Moon   Light')).toBe('moon light')
    expect(normalizeName('검은달_77')).toBe('검은달_77')
    expect(normalizeName('A.B')).not.toBe(normalizeName('AB'))
  })
  it('OCR 줄의 테두리·불릿 잡음만 제거한다', () => {
    expect(cleanOcrLine('| 별빛하나 |')).toBe('별빛하나')
    expect(cleanOcrLine('• 검은달_77')).toBe('검은달_77')
    expect(cleanOcrLine('검은달_77')).toBe('검은달_77')
  })
})

describe('매칭', () => {
  it('정확 일치와 별칭 일치는 자동 선택된다', () => {
    const exact = matchText(index, '별빛하나', { sourceId: 's', key: 'k1' })
    expect(exact.status).toBe('exact')
    expect(exact.memberId).toBe('a')
    expect(exact.selected).toBe(true)
    const alias = matchText(index, '별빛1', { sourceId: 's', key: 'k2' })
    expect(alias.status).toBe('alias')
    expect(alias.memberId).toBe('a')
  })

  it('비슷한 닉네임은 자동 확정하지 않고 확인 필요로 둔다', () => {
    const r = matchText(index, '별빛하녀', { sourceId: 's', key: 'k' })
    expect(r.status).toBe('review')
    expect(r.memberId).toBeNull()
    expect(r.selected).toBe(false)
    expect(r.suggestions.map((s) => s.memberId)).toEqual(expect.arrayContaining(['a', 'b']))
    // 유사도 점수와 OCR 신뢰도는 따로 보관된다
    expect(r.ocrConfidence).toBeNull()
    expect(r.suggestions[0].score).toBeLessThan(1)
  })

  it('한 글자 차이 실제 닉네임끼리는 서로 정확 일치로만 연결된다', () => {
    expect(matchText(index, '별빛하니', { sourceId: 's', key: 'x' }).memberId).toBe('b')
    expect(matchText(index, '별빛하나', { sourceId: 's', key: 'y' }).memberId).toBe('a')
  })

  it('등록되지 않은 텍스트는 미등록이며 새 길드원으로 만들지 않는다', () => {
    const r = matchText(index, '전혀다른사람', { sourceId: 's', key: 'k' })
    expect(r.status).toBe('unregistered')
    expect(r.memberId).toBeNull()
  })

  it('하나의 키가 여러 사람과 충돌하면 자동 매칭을 막는다', () => {
    const clash = buildRosterIndex([
      { id: 'x', nickname: '쌍둥이', aliases: [] },
      { id: 'y', nickname: '다른이', aliases: ['쌍둥이'] },
    ])
    const r = matchText(clash, '쌍둥이', { sourceId: 's', key: 'k' })
    expect(r.status).toBe('review')
    expect(r.memberId).toBeNull()
    expect(r.conflict).toContain('여러 길드원')
  })

  it('한 줄에 닉네임과 잡음이 섞여 있으면 일치하는 조각을 찾는다', () => {
    const items = matchOcrLines(index, [{ text: 'Lv.80 별빛하나 전사', confidence: 88 }], 'img1')
    expect(items.map((i) => [i.status, i.memberId])).toEqual([['exact', 'a']])
    expect(items[0].ocrConfidence).toBe(88)
  })

  it('공백이 들어간 닉네임은 줄 전체로 일치시킨다', () => {
    const items = matchOcrLines(index, [{ text: 'Moon Light', confidence: 90 }], 'img1')
    expect(items[0].memberId).toBe('c')
  })

  // 브라우저에서 실제 Tesseract 로 합성 이미지를 읽었을 때 나온 줄 형태 (열 사이 넓은 공백)
  it('열이 나뉜 OCR 줄에서 공백 포함 닉네임은 일치, 오인식 닉네임은 확인 필요로 남긴다', () => {
    const items = matchOcrLines(
      index,
      [
        { text: 'Lv.62       Moon Light                     전사', confidence: 95 },
        { text: 'Lv.60       별빚하나                        전사', confidence: 93 },
        { text: 'Lv.61    검은달 77             전사', confidence: 93 },
        { text: 'Lv.63    신규회원             전사', confidence: 93 },
      ],
      'img',
    )
    const [moon, star, dark, unknown] = items
    expect([moon.status, moon.memberId]).toEqual(['exact', 'c'])
    expect(star.status).toBe('review')
    expect(star.raw).toBe('별빚하나')
    expect(star.memberId).toBeNull()
    expect(star.suggestions.slice(0, 2).map((s) => s.memberId).sort()).toEqual(['a', 'b'])
    expect(dark.status).toBe('review')
    expect(dark.suggestions[0].memberId).toBe('d')
    expect(unknown.status).toBe('unregistered')
    expect(items).toHaveLength(4)
  })

  it('여러 이미지에서 같은 길드원이 나와도 최종 명단에는 한 번만 들어간다', () => {
    const one = matchOcrLines(index, [{ text: '별빛하나', confidence: 90 }, { text: '하이', confidence: 90 }], 'img1')
    const two = matchOcrLines(index, [{ text: '별빛1', confidence: 70 }, { text: '하이', confidence: 95 }], 'img2')
    const final = finalAttendees([...one, ...two], ['e'], byId)
    expect(final.map((f) => f.memberId).sort()).toEqual(['a', 'e'])
    const a = final.find((f) => f.memberId === 'a')!
    expect(a.matchMethod).toBe('exact')
    expect(a.occurrences).toBe(2)
    expect(final.find((f) => f.memberId === 'e')!.occurrences).toBe(3)
  })

  it('확인 필요 항목은 관리자가 연결해야만 포함되고 수동 확인으로 기록된다', () => {
    const [item] = matchOcrLines(index, [{ text: '별빛하녀', confidence: 60 }], 'img')
    expect(finalAttendees([item], [], byId)).toEqual([])
    const linked = { ...item, memberId: 'b', selected: true }
    expect(finalAttendees([linked], [], byId)).toEqual([{ memberId: 'b', nickname: '별빛하니', matchMethod: 'manual', occurrences: 1 }])
  })

  it('제외한 항목과 체크 해제한 항목은 빠진다', () => {
    const [item] = matchOcrLines(index, [{ text: '별빛하나', confidence: 90 }], 'img')
    expect(finalAttendees([{ ...item, status: 'excluded', selected: false }], [], byId)).toEqual([])
    expect(finalAttendees([{ ...item, selected: false }], [], byId)).toEqual([])
  })

  it('OCR 결과가 없어도 수동 입력만으로 참여자를 만들 수 있다', () => {
    expect(finalAttendees([], ['d', 'c'], byId).map((f) => f.nickname)).toEqual(['검은달_77', 'Moon Light'].sort((x, y) => x.localeCompare(y, 'ko')))
  })
})

describe('유사도', () => {
  it('자모 단위로 계산한다', () => {
    expect(similarity('별빛', '별빛')).toBe(1)
    expect(similarity('별빛하나', '별빛하니')).toBeGreaterThan(0.8)
    expect(similarity('가나다', 'xyz')).toBeLessThan(0.2)
  })
})

describe('닉네임 검색', () => {
  const members = [
    { id: '1', nickname: '달빛기사', aliases: ['달기'] },
    { id: '2', nickname: '달빛궁수', aliases: [] },
    { id: '3', nickname: '해돋이', aliases: ['달빛X'] },
  ]
  it('부분 검색과 별칭 검색을 지원하고, 후보를 순서대로 반환한다', () => {
    expect(searchMembers(members, '달빛').map((m) => m.id)).toEqual(['2', '1', '3'])
    expect(searchMembers(members, '달기').map((m) => m.id)).toEqual(['1'])
    expect(searchMembers(members, '없는사람')).toEqual([])
    expect(searchMembers(members, '  ')).toEqual([])
  })
})
