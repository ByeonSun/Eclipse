import { useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import type { Rect } from '../lib/ocr'

/**
 * 이미지 위에서 드래그로 OCR 영역을 지정한다. 좌표는 원본 픽셀 기준으로 돌려준다.
 * 선택 상자는 이미지 크기에 대한 백분율로 그려서, 화면 크기가 바뀌어도 위치가 맞는다.
 * 키보드 사용자는 영역 지정 없이 전체 이미지 인식을 쓸 수 있다.
 */
export function RegionSelector({
  src,
  naturalWidth,
  naturalHeight,
  value,
  onChange,
  alt,
}: {
  src: string
  naturalWidth: number
  naturalHeight: number
  value: Rect | null
  onChange: (r: Rect | null) => void
  alt: string
}) {
  const boxRef = useRef<HTMLDivElement>(null)
  const start = useRef<{ x: number; y: number } | null>(null)
  const [draft, setDraft] = useState<Rect | null>(null)

  const toNatural = (e: RPointerEvent) => {
    const box = boxRef.current!.getBoundingClientRect()
    const x = Math.min(Math.max(e.clientX - box.left, 0), box.width)
    const y = Math.min(Math.max(e.clientY - box.top, 0), box.height)
    return { x: (x / box.width) * naturalWidth, y: (y / box.height) * naturalHeight }
  }

  const shown = draft ?? value
  const pct = (v: number, of: number) => `${(v / of) * 100}%`

  return (
    <div className="region">
      <div
        ref={boxRef}
        style={{ position: 'relative', display: 'inline-block', maxWidth: '100%' }}
        onPointerDown={(e) => {
          if (e.button !== 0) return
          e.currentTarget.setPointerCapture?.(e.pointerId)
          start.current = toNatural(e)
          setDraft({ ...start.current, w: 0, h: 0 })
        }}
        onPointerMove={(e) => {
          if (!start.current) return
          const p = toNatural(e)
          const s = start.current
          setDraft({ x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y) })
        }}
        onPointerUp={() => {
          const d = draft
          start.current = null
          setDraft(null)
          if (d && d.w > 12 && d.h > 12) {
            onChange({ x: Math.round(d.x), y: Math.round(d.y), w: Math.round(d.w), h: Math.round(d.h) })
          }
        }}
        onPointerCancel={() => {
          start.current = null
          setDraft(null)
        }}
      >
        <img src={src} alt={alt} draggable={false} />
        {shown && (
          <div
            className="region__sel"
            aria-hidden="true"
            style={{
              left: pct(shown.x, naturalWidth),
              top: pct(shown.y, naturalHeight),
              width: pct(shown.w, naturalWidth),
              height: pct(shown.h, naturalHeight),
            }}
          />
        )}
      </div>
    </div>
  )
}
