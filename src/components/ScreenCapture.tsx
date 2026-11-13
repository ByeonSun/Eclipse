import { useEffect, useRef, useState } from 'react'
import { Dialog, Notice } from './ui'

export function screenCaptureSupported(): boolean {
  if (typeof navigator === 'undefined') return false
  const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches
  return !coarse && !!navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === 'function'
}

/**
 * 보조 기능: 브라우저의 화면 공유 창에서 사용자가 직접 고른 창/화면의 현재 프레임을 정지 이미지로 가져온다.
 * 웹페이지는 실행 중인 프로그램 목록을 볼 수 없고 특정 창을 자동 선택할 수도 없다.
 * 가져올 수 있는 것은 사용자가 공유한 화면 안쪽뿐이다.
 */
export function ScreenCapture({ onCapture }: { onCapture: (file: File) => void }) {
  const [open, setOpen] = useState(false)
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [error, setError] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)

  const stop = () => {
    stream?.getTracks().forEach((t) => t.stop())
    setStream(null)
  }

  useEffect(() => () => stream?.getTracks().forEach((t) => t.stop()), [stream])

  useEffect(() => {
    if (videoRef.current && stream) videoRef.current.srcObject = stream
  }, [stream, open])

  const start = async () => {
    setError(null)
    try {
      const s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 5 }, audio: false })
      s.getVideoTracks()[0]?.addEventListener('ended', () => setStream(null))
      setStream(s)
      setOpen(true)
    } catch (e) {
      const name = (e as DOMException)?.name
      if (name === 'NotAllowedError' || name === 'AbortError') setError('화면 공유를 취소했습니다.')
      else setError('화면 공유를 시작하지 못했습니다. 캡처 이미지 붙여넣기나 업로드를 사용하세요.')
    }
  }

  const grab = async () => {
    const v = videoRef.current
    if (!v || !v.videoWidth) return
    const c = document.createElement('canvas')
    c.width = v.videoWidth
    c.height = v.videoHeight
    c.getContext('2d')!.drawImage(v, 0, 0)
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'))
    if (blob) onCapture(new File([blob], `화면공유-${new Date().toISOString().slice(11, 19)}.png`, { type: 'image/png' }))
    stop()
    setOpen(false)
  }

  const close = () => {
    stop()
    setOpen(false)
  }

  return (
    <>
      <button type="button" className="btn btn--sm" onClick={start}>
        화면 공유에서 가져오기
      </button>
      {error && <span className="small muted">{error}</span>}
      <Dialog open={open} title="화면 공유 미리보기" onClose={close} wide>
        <Notice tone="info">
          <p>
            브라우저 공유 창에서 직접 고른 화면만 보입니다. 원하는 장면에서 “현재 화면 가져오기”를 누르면 정지 이미지로 추가되고,
            그다음 이미지 위에서 인식할 영역을 지정할 수 있습니다.
          </p>
        </Notice>
        {stream ? (
          <div className="region" style={{ cursor: 'default' }}>
            <video ref={videoRef} autoPlay muted playsInline />
          </div>
        ) : (
          <Notice tone="warn">
            <p>화면 공유가 종료되었습니다.</p>
          </Notice>
        )}
        <div className="row row--end" style={{ marginTop: 12 }}>
          <button type="button" className="btn" onClick={close}>
            공유 종료
          </button>
          <button type="button" className="btn btn--primary" onClick={grab} disabled={!stream}>
            현재 화면 가져오기
          </button>
        </div>
      </Dialog>
    </>
  )
}
