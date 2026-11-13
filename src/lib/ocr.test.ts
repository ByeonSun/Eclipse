import { beforeEach, describe, expect, it, vi } from 'vitest'

// 실제 Tesseract 워커 대신, recognize 가 끝나지 않는(=사용자가 취소해야 하는) 가짜 워커
const state = vi.hoisted(() => ({ hang: true, created: 0, terminated: 0 }))
vi.mock('tesseract.js', () => ({
  createWorker: vi.fn(async () => {
    state.created++
    return {
      setParameters: async () => ({}),
      recognize: () =>
        state.hang
          ? new Promise(() => {})
          : Promise.resolve({
              data: {
                text: '별빛하나\n하이',
                blocks: [{ paragraphs: [{ lines: [{ text: '별빛하나 ', confidence: 91.4 }, { text: '하이', confidence: 88.6 }] }] }],
              },
            }),
      terminate: async () => {
        state.terminated++
      },
    }
  }),
}))

import { cancelOcr, OcrCancelled, recognizeCanvas } from './ocr'

const canvas = {} as HTMLCanvasElement

describe('OCR 취소와 재시도', () => {
  beforeEach(() => {
    state.hang = true
  })

  it('인식 중 취소하면 바로 OcrCancelled 로 끝나고 워커를 종료한다', async () => {
    const p = recognizeCanvas(canvas, () => {})
    await new Promise((r) => setTimeout(r, 5))
    await cancelOcr()
    await expect(p).rejects.toBeInstanceOf(OcrCancelled)
    expect(state.terminated).toBe(1)
  })

  it('취소 후 다시 시도하면 새 워커로 정상 인식한다', async () => {
    state.hang = false
    const before = state.created
    const lines = await recognizeCanvas(canvas, () => {})
    expect(state.created).toBe(before + 1)
    expect(lines).toEqual([
      { text: '별빛하나', confidence: 91 },
      { text: '하이', confidence: 89 },
    ])
  })
})
