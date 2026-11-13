// Tesseract.js (브라우저 Web Worker) 래퍼. 이미지는 브라우저 안에서만 처리하고 서버로 보내지 않는다.
// 워커 스크립트·WASM 코어·언어 데이터(kor, eng)는 tesseract.js 기본값인 jsDelivr CDN 에서 내려받는다.
import { createWorker, type Worker } from 'tesseract.js'
import type { OcrToken } from './matching'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface OcrProgress {
  status: string
  progress: number
}

export class OcrCancelled extends Error {
  constructor() {
    super('OCR을 취소했습니다.')
  }
}

const STATUS_KO: Record<string, string> = {
  'loading tesseract core': 'OCR 엔진 불러오는 중',
  'initializing tesseract': 'OCR 엔진 준비 중',
  'initialized tesseract': 'OCR 엔진 준비 완료',
  'loading language traineddata': '한국어·영어 데이터 불러오는 중',
  'loading language traineddata (from cache)': '언어 데이터 불러오는 중(캐시)',
  'loaded language traineddata': '언어 데이터 준비 완료',
  'initializing api': '인식기 초기화 중',
  'initialized api': '인식기 준비 완료',
  'recognizing text': '글자 인식 중',
}

export function ocrStatusLabel(s: string): string {
  return STATUS_KO[s] ?? s
}

let workerPromise: Promise<Worker> | null = null
let listener: ((p: OcrProgress) => void) | null = null

function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = createWorker(['kor', 'eng'], 1, {
      logger: (m) => listener?.({ status: m.status, progress: m.progress ?? 0 }),
      errorHandler: () => {},
    }).catch((e) => {
      workerPromise = null
      throw e
    })
  }
  return workerPromise
}

let cancelled = false
let rejectCurrent: (() => void) | null = null

/**
 * 진행 중인 OCR 을 즉시 중단 (워커를 종료하고 다음 요청 때 새로 만든다).
 * 워커를 종료해도 진행 중이던 recognize() 약속은 끝나지 않으므로, 대기 중인 호출은 직접 거부한다.
 */
export async function cancelOcr() {
  const p = workerPromise
  workerPromise = null
  cancelled = true
  rejectCurrent?.()
  rejectCurrent = null
  if (p) {
    try {
      const w = await p
      await w.terminate()
    } catch {
      /* 이미 종료됨 */
    }
  }
}

/**
 * 이미지(또는 선택 영역)를 전처리해 OCR.
 * 게임 UI 는 어두운 배경 + 밝은 글씨가 많아 밝기를 보고 반전하고, 작은 글씨는 2배 확대한다.
 */
export async function recognizeImage(
  image: HTMLImageElement | ImageBitmap,
  rect: Rect | null,
  onProgress: (p: OcrProgress) => void,
): Promise<OcrToken[]> {
  return recognizeCanvas(preprocess(image, rect), onProgress)
}

export async function recognizeCanvas(
  canvas: HTMLCanvasElement,
  onProgress: (p: OcrProgress) => void,
): Promise<OcrToken[]> {
  cancelled = false
  listener = onProgress
  const cancelGate = new Promise<never>((_, reject) => {
    rejectCurrent = () => reject(new OcrCancelled())
  })
  const guard = <T,>(p: Promise<T>) => Promise.race([p, cancelGate])
  try {
    const worker = await guard(getWorker())
    if (cancelled) throw new OcrCancelled()
    await guard(worker.setParameters({ preserve_interword_spaces: '1' }))
    const { data } = await guard(worker.recognize(canvas, {}, { text: true, blocks: true }))
    if (cancelled) throw new OcrCancelled()
    const lines: OcrToken[] = []
    for (const b of data.blocks ?? []) {
      for (const p of b.paragraphs) {
        for (const l of p.lines) {
          const text = l.text.trim()
          if (text) lines.push({ text, confidence: Math.round(l.confidence) })
        }
      }
    }
    if (!lines.length && data.text.trim()) {
      for (const t of data.text.split(/\r?\n/)) if (t.trim()) lines.push({ text: t.trim(), confidence: null })
    }
    return lines
  } catch (e) {
    if (cancelled) throw new OcrCancelled()
    throw e
  } finally {
    listener = null
    rejectCurrent = null
    cancelGate.catch(() => {})
  }
}

export function preprocess(image: HTMLImageElement | ImageBitmap, rect: Rect | null): HTMLCanvasElement {
  const iw = 'naturalWidth' in image ? image.naturalWidth : image.width
  const ih = 'naturalHeight' in image ? image.naturalHeight : image.height
  const r = rect ?? { x: 0, y: 0, w: iw, h: ih }
  const scale = r.h < 600 && r.w < 1600 ? 2 : 1
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(r.w * scale))
  canvas.height = Math.max(1, Math.round(r.h * scale))
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(image, r.x, r.y, r.w, r.h, 0, 0, canvas.width, canvas.height)
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const d = img.data
  let sum = 0
  for (let i = 0; i < d.length; i += 4) {
    const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
    d[i] = d[i + 1] = d[i + 2] = g
    sum += g
  }
  const invert = sum / (d.length / 4) < 128
  if (invert) for (let i = 0; i < d.length; i += 4) d[i] = d[i + 1] = d[i + 2] = 255 - d[i]
  ctx.putImageData(img, 0, 0)
  return canvas
}
