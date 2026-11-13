// Tesseract.js (브라우저 Web Worker) 래퍼. 이미지는 브라우저 안에서만 처리하고 서버로 보내지 않는다.
// 워커 스크립트·WASM 코어·언어 데이터(kor, eng)는 tesseract.js 기본값인 jsDelivr CDN 에서 내려받는다.
//
// 두 가지 인식 방식:
//  - 이름표 모드(게임 화면): 캐릭터 머리 위 이름표를 색·외곽선으로 찾아 하나씩 한국어 인식 (recognizeNameTags)
//  - 글자 목록 모드: 화면 전체를 일반 문서처럼 인식 (recognizeImage)
import { createWorker, type Worker } from 'tesseract.js'
import type { OcrToken } from './matching'
import { detectNameTags, NAME_TAG_PROFILES, otsuThreshold, rgbToHsv, type Box, type ColorRule, type NameTagProfile } from './nameTags'

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

type WorkerKind = 'mixed' | 'kor'
const workers: Partial<Record<WorkerKind, Promise<Worker>>> = {}
let listener: ((p: OcrProgress) => void) | null = null

function getWorker(kind: WorkerKind): Promise<Worker> {
  let p = workers[kind]
  if (!p) {
    p = createWorker(kind === 'kor' ? 'kor' : ['kor', 'eng'], 1, {
      logger: (m) => listener?.({ status: m.status, progress: m.progress ?? 0 }),
      errorHandler: () => {},
    }).catch((e) => {
      delete workers[kind]
      throw e
    })
    workers[kind] = p
  }
  return p
}

let cancelled = false
let rejectCurrent: (() => void) | null = null

/**
 * 진행 중인 OCR 을 즉시 중단 (워커를 종료하고 다음 요청 때 새로 만든다).
 * 워커를 종료해도 진행 중이던 recognize() 약속은 끝나지 않으므로, 대기 중인 호출은 직접 거부한다.
 */
export async function cancelOcr() {
  const pending = Object.values(workers)
  for (const k of Object.keys(workers) as WorkerKind[]) delete workers[k]
  cancelled = true
  rejectCurrent?.()
  rejectCurrent = null
  for (const p of pending) {
    try {
      const w = await p
      await w!.terminate()
    } catch {
      /* 이미 종료됨 */
    }
  }
}

/** 취소 가능한 작업 실행 틀 */
async function cancellable<T>(onProgress: (p: OcrProgress) => void, fn: (guard: <U>(p: Promise<U>) => Promise<U>) => Promise<T>) {
  cancelled = false
  listener = onProgress
  const cancelGate = new Promise<never>((_, reject) => {
    rejectCurrent = () => reject(new OcrCancelled())
  })
  const guard = <U,>(p: Promise<U>) => Promise.race([p, cancelGate])
  try {
    const out = await fn(guard)
    if (cancelled) throw new OcrCancelled()
    return out
  } catch (e) {
    if (cancelled) throw new OcrCancelled()
    throw e
  } finally {
    listener = null
    rejectCurrent = null
    cancelGate.catch(() => {})
  }
}

// ---------------------------------------------------------------------------
// 글자 목록 모드
// ---------------------------------------------------------------------------
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

export async function recognizeCanvas(canvas: HTMLCanvasElement, onProgress: (p: OcrProgress) => void): Promise<OcrToken[]> {
  return cancellable(onProgress, async (guard) => {
    const worker = await guard(getWorker('mixed'))
    if (cancelled) throw new OcrCancelled()
    await guard(worker.setParameters({ preserve_interword_spaces: '1', tessedit_pageseg_mode: '3' as never }))
    const { data } = await guard(worker.recognize(canvas, {}, { text: true, blocks: true }))
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
  })
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

// ---------------------------------------------------------------------------
// 이름표 모드
// ---------------------------------------------------------------------------
export interface NameTagRead {
  /** 원본 이미지 좌표 */
  box: Rect
  profile: NameTagProfile['id']
  reads: { text: string; confidence: number; variant: string }[]
}

type Variant = { id: string; make: (src: HTMLCanvasElement, b: Box, p: NameTagProfile) => HTMLCanvasElement }

function cropScaled(src: HTMLCanvasElement, b: Box, scale: number, pad: number) {
  const x0 = Math.max(0, b.x - pad)
  const y0 = Math.max(0, b.y - pad)
  const w = Math.min(src.width - x0, b.w + pad * 2)
  const h = Math.min(src.height - y0, b.h + pad * 2)
  const c = document.createElement('canvas')
  c.width = w * scale
  c.height = h * scale
  const g = c.getContext('2d', { willReadFrequently: true })!
  g.imageSmoothingQuality = 'high'
  g.drawImage(src, x0, y0, w, h, 0, 0, c.width, c.height)
  return { c, g }
}

/** 확대한 뒤 이름표 색만 검게. thicken 만큼 획을 1px씩 굵혀 작은 받침이 끊기지 않게 */
function hueVariant(scale: number, pick: (p: NameTagProfile) => ColorRule, thicken = 0): Variant['make'] {
  return (src, b, p) => {
    const rule = pick(p)
    const { c, g } = cropScaled(src, b, scale, 4)
    const W = c.width
    const H = c.height
    const id = g.getImageData(0, 0, W, H)
    const d = id.data
    let on = new Uint8Array(W * H)
    for (let i = 0, j = 0; i < d.length; i += 4, j++) {
      const [h, s, v] = rgbToHsv(d[i], d[i + 1], d[i + 2])
      on[j] = h >= rule.h[0] && h <= rule.h[1] && s >= rule.s[0] && s <= rule.s[1] && v >= rule.v ? 1 : 0
    }
    for (let t = 0; t < thicken; t++) {
      const next = on.slice()
      for (let y = 1; y < H - 1; y++) {
        for (let x = 1; x < W - 1; x++) {
          const j = y * W + x
          if (on[j - 1] || on[j + 1] || on[j - W] || on[j + W]) next[j] = 1
        }
      }
      on = next
    }
    for (let j = 0; j < W * H; j++) d[j * 4] = d[j * 4 + 1] = d[j * 4 + 2] = on[j] ? 0 : 255
    g.putImageData(id, 0, 0)
    return c
  }
}

/** 밝기 + Otsu, 글자 쪽이 검게 오도록 극성 보정 */
function otsuVariant(scale: number): Variant['make'] {
  return (src, b) => {
    const { c, g } = cropScaled(src, b, scale, 2)
    const id = g.getImageData(0, 0, c.width, c.height)
    const d = id.data
    const vals = new Float32Array(d.length / 4)
    for (let i = 0, j = 0; i < d.length; i += 4, j++) vals[j] = Math.max(d[i], d[i + 1], d[i + 2])
    const th = otsuThreshold(vals)
    let black = 0
    for (let j = 0; j < vals.length; j++) if (vals[j] > th) black++
    const flip = black > vals.length / 2
    for (let i = 0, j = 0; i < d.length; i += 4, j++) {
      const isText = vals[j] > th !== flip
      d[i] = d[i + 1] = d[i + 2] = isText ? 0 : 255
    }
    g.putImageData(id, 0, 0)
    return c
  }
}

// 실제 캡처(2340×1080)를 100%·85%·70% 크기로 바꿔 가며 비교해 고른 조합
const VARIANTS: Variant[] = [
  { id: 'hue3', make: hueVariant(3, (p) => p.rule) },
  { id: 'hueWide3', make: hueVariant(3, (p) => p.relaxed) },
  { id: 'hueWide4Thick', make: hueVariant(4, (p) => p.relaxed, 1) },
  { id: 'otsu2', make: otsuVariant(2) },
  { id: 'otsu3', make: otsuVariant(3) },
]

/** 한 화면에서 이름표가 지나치게 많이 잡히면(예: 잘못된 색 범위) 앞쪽 일부만 */
const MAX_TAGS = 60

export async function recognizeNameTags(
  image: HTMLImageElement | ImageBitmap,
  rect: Rect | null,
  onProgress: (p: OcrProgress) => void,
): Promise<NameTagRead[]> {
  const iw = 'naturalWidth' in image ? image.naturalWidth : image.width
  const ih = 'naturalHeight' in image ? image.naturalHeight : image.height
  const r = rect ?? { x: 0, y: 0, w: iw, h: ih }
  const src = document.createElement('canvas')
  src.width = r.w
  src.height = r.h
  const sg = src.getContext('2d', { willReadFrequently: true })!
  sg.drawImage(image, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h)
  const pixels = sg.getImageData(0, 0, r.w, r.h).data

  const found: { box: Box; profile: NameTagProfile }[] = []
  for (const profile of NAME_TAG_PROFILES) {
    for (const box of detectNameTags(pixels, r.w, r.h, profile.rule).boxes) found.push({ box, profile })
  }
  const targets = found.slice(0, MAX_TAGS)

  return cancellable(onProgress, async (guard) => {
    const worker = await guard(getWorker('kor'))
    if (cancelled) throw new OcrCancelled()
    listener = null // 이름표마다 0~100% 를 반복하는 엔진 진행률 대신, 아래에서 전체 진행률을 직접 보낸다
    await guard(worker.setParameters({ tessedit_pageseg_mode: '7' as never, preserve_interword_spaces: '1' }))
    const out: NameTagRead[] = []
    const total = targets.length * VARIANTS.length
    let done = 0
    for (const { box, profile } of targets) {
      const reads: NameTagRead['reads'] = []
      for (const v of VARIANTS) {
        const { data } = await guard(worker.recognize(v.make(src, box, profile)))
        if (cancelled) throw new OcrCancelled()
        const text = data.text.replace(/\s+/g, ' ').trim()
        if (text) reads.push({ text, confidence: Math.round(data.confidence), variant: v.id })
        done++
        onProgress({ status: `이름표 인식 중 (${Math.ceil(done / VARIANTS.length)}/${targets.length})`, progress: done / total })
      }
      out.push({ box: { x: box.x + r.x, y: box.y + r.y, w: box.w, h: box.h }, profile: profile.id, reads })
    }
    return out
  })
}
