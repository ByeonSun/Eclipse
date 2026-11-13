// 게임 화면 속 캐릭터 이름표 찾기 (순수 함수, 브라우저·테스트 공용)
//
// 실제 캡처(2026-11-13)에서 측정한 이름표 특징:
//  - 길드원 이름: 연한 남색 글자(H 216~228°, S 0.33~0.46, V 0.6~0.95) + 진한 외곽선
//  - 초록 이름:   H 112~125°, S 0.28~0.42, V 0.5~0.7 + 진한 외곽선
//  - 높이 약 14~24px, 배경은 지형·이펙트(빛기둥은 H 196~203°, 채도 낮음)
// 글자색과 "근처에 어두운 외곽선이 있는가"를 함께 보면 빛기둥·하늘 같은 큰 색 덩어리를 걸러낼 수 있다.

export interface ColorRule {
  h: [number, number]
  s: [number, number]
  v: number
}

export interface NameTagProfile {
  id: 'blue' | 'green'
  label: string
  rule: ColorRule
  /** 인식 변형용으로 조금 넓힌 범위 */
  relaxed: ColorRule
}

export const NAME_TAG_PROFILES: NameTagProfile[] = [
  {
    id: 'blue',
    label: '파란 이름',
    rule: { h: [210, 236], s: [0.26, 0.62], v: 0.5 },
    relaxed: { h: [208, 238], s: [0.22, 0.7], v: 0.45 },
  },
  {
    id: 'green',
    label: '초록 이름',
    rule: { h: [105, 132], s: [0.24, 0.6], v: 0.45 },
    relaxed: { h: [100, 138], s: [0.2, 0.66], v: 0.4 },
  },
]

export interface Box {
  x: number
  y: number
  w: number
  h: number
  /** 글자색 픽셀 수 */
  pixels: number
}

export function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const mx = Math.max(r, g, b)
  const mn = Math.min(r, g, b)
  const d = mx - mn
  let h = 0
  if (d) {
    if (mx === r) h = ((g - b) / d) % 6
    else if (mx === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  return [h, mx ? d / mx : 0, mx / 255]
}

export function inRule(r: number, g: number, b: number, rule: ColorRule): boolean {
  const [h, s, v] = rgbToHsv(r, g, b)
  return h >= rule.h[0] && h <= rule.h[1] && s >= rule.s[0] && s <= rule.s[1] && v >= rule.v
}

export interface DetectOptions {
  /** 외곽선으로 볼 어두운 정도 (V 미만) */
  darkV?: number
  /** 외곽선을 찾을 반경(px) */
  radius?: number
  minH?: number
  maxH?: number
  minW?: number
  maxW?: number
  minPixels?: number
}

/**
 * RGBA 픽셀 배열에서 이름표 후보 상자를 찾는다.
 * 1) 글자색이면서 반경 안에 어두운 외곽선 픽셀이 있는 점만 남김
 * 2) 가로로 넓게(글자 사이), 세로로 조금 팽창해 한 이름을 한 덩어리로
 * 3) 크기·밀도로 거름
 */
export function detectNameTags(
  data: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  rule: ColorRule,
  opts: DetectOptions = {},
): { boxes: Box[]; mask: Uint8Array } {
  const { darkV = 0.4, radius = 2, minH = 10, maxH = 44, minW = 14, maxW = 300, minPixels = 18 } = opts
  const N = width * height
  const col = new Uint8Array(N)
  const dark = new Uint8Array(N)
  for (let i = 0; i < N; i++) {
    const r = data[i * 4]
    const g = data[i * 4 + 1]
    const b = data[i * 4 + 2]
    const [h, s, v] = rgbToHsv(r, g, b)
    col[i] = h >= rule.h[0] && h <= rule.h[1] && s >= rule.s[0] && s <= rule.s[1] && v >= rule.v ? 1 : 0
    dark[i] = v < darkV ? 1 : 0
  }
  const mask = new Uint8Array(N)
  for (let y = radius; y < height - radius; y++) {
    for (let x = radius; x < width - radius; x++) {
      const i = y * width + x
      if (!col[i]) continue
      let near = false
      for (let dy = -radius; dy <= radius && !near; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (dark[i + dy * width + dx]) {
            near = true
            break
          }
        }
      }
      if (near) mask[i] = 1
    }
  }

  // 팽창: 가로 ±6, 세로 ±2
  const DX = 6
  const DY = 2
  const dil = new Uint8Array(N)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!mask[y * width + x]) continue
      const y0 = Math.max(0, y - DY)
      const y1 = Math.min(height - 1, y + DY)
      const x0 = Math.max(0, x - DX)
      const x1 = Math.min(width - 1, x + DX)
      for (let yy = y0; yy <= y1; yy++) dil.fill(1, yy * width + x0, yy * width + x1 + 1)
    }
  }

  const seen = new Uint8Array(N)
  const boxes: Box[] = []
  const stack: number[] = []
  for (let i = 0; i < N; i++) {
    if (!dil[i] || seen[i]) continue
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -1
    let y1 = -1
    let pixels = 0
    seen[i] = 1
    stack.push(i)
    while (stack.length) {
      const j = stack.pop()!
      const x = j % width
      const y = (j - x) / width
      if (mask[j]) pixels++
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
      if (x > 0 && dil[j - 1] && !seen[j - 1]) (seen[j - 1] = 1), stack.push(j - 1)
      if (x < width - 1 && dil[j + 1] && !seen[j + 1]) (seen[j + 1] = 1), stack.push(j + 1)
      if (y > 0 && dil[j - width] && !seen[j - width]) (seen[j - width] = 1), stack.push(j - width)
      if (y < height - 1 && dil[j + width] && !seen[j + width]) (seen[j + width] = 1), stack.push(j + width)
    }
    const w = x1 - x0 + 1
    const h = y1 - y0 + 1
    if (h >= minH && h <= maxH && w >= minW && w <= maxW && pixels >= minPixels) {
      boxes.push({ x: x0, y: y0, w, h, pixels })
    }
  }
  // 위에서 아래, 왼쪽에서 오른쪽
  boxes.sort((a, b) => a.y - b.y || a.x - b.x)
  return { boxes, mask }
}

/** Otsu 임계값 (0~255 값 배열) */
export function otsuThreshold(values: ArrayLike<number>): number {
  const hist = new Array<number>(256).fill(0)
  for (let i = 0; i < values.length; i++) hist[Math.max(0, Math.min(255, values[i] | 0))]++
  const total = values.length
  let sum = 0
  for (let i = 0; i < 256; i++) sum += i * hist[i]
  let sumB = 0
  let wB = 0
  let best = -1
  let th = 128
  for (let t = 0; t < 256; t++) {
    wB += hist[t]
    if (!wB) continue
    const wF = total - wB
    if (!wF) break
    sumB += t * hist[t]
    const mB = sumB / wB
    const mF = (sum - sumB) / wF
    const between = wB * wF * (mB - mF) ** 2
    if (between > best) {
      best = between
      th = t
    }
  }
  return th
}
