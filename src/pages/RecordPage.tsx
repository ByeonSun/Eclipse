import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MemberSearch } from '../components/MemberSearch'
import { RegionSelector } from '../components/RegionSelector'
import { ScreenCapture, screenCaptureSupported } from '../components/ScreenCapture'
import { ErrorNotice, LevelBadge, Loading, MatchBadge, Notice, useToast } from '../components/ui'
import { useRoster } from '../data/RosterProvider'
import { activeAt, fetchRun, saveBossRun } from '../lib/api'
import { ACCEPTED_IMAGE_TYPES, BOSS_LEVELS, MAX_IMAGE_BYTES, MAX_IMAGE_PIXELS } from '../lib/constants'
import { errorMessage, isMembershipConflict } from '../lib/errors'
import { finalAttendees, matchOcrLines, type MatchItem } from '../lib/matching'
import { cancelOcr, OcrCancelled, ocrStatusLabel, recognizeImage, type Rect } from '../lib/ocr'
import { href, navigate } from '../lib/router'
import { formatKst, fromKstInputValue, toKstInputValue } from '../lib/time'

type OcrState = 'queued' | 'running' | 'done' | 'error' | 'cancelled'

interface Shot {
  id: string
  name: string
  url: string
  img: HTMLImageElement
  width: number
  height: number
  rect: Rect | null
  state: OcrState
  progress: number
  statusText: string
  error: string | null
  items: MatchItem[]
  lineCount: number
}

type Method = 'exact' | 'alias' | 'manual'

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('이미지를 읽을 수 없습니다.'))
    img.src = url
  })
}

export function RecordPage({ editId }: { editId?: string }) {
  const roster = useRoster()
  const toast = useToast()
  const [runId] = useState(() => editId ?? crypto.randomUUID())
  const [shots, setShots] = useState<Shot[]>([])
  const [manual, setManual] = useState<string[]>([])
  const [preset, setPreset] = useState<Map<string, Method>>(new Map())
  const [level, setLevel] = useState<number | null>(null)
  const [occurredInput, setOccurredInput] = useState(() => toKstInputValue(new Date()))
  const [note, setNote] = useState('')
  const [inputErrors, setInputErrors] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [over, setOver] = useState(false)
  const [editState, setEditState] = useState<{ loading: boolean; error: string | null; expected: string | null; cancelled: boolean }>(
    { loading: !!editId, error: null, expected: null, cancelled: false },
  )
  const fileRef = useRef<HTMLInputElement>(null)
  const savingRef = useRef(false)
  const shotsRef = useRef(shots)
  shotsRef.current = shots

  // ------------------------------------------------------------ 수정 모드 불러오기
  const loadEdit = useCallback(async () => {
    if (!editId) return
    setEditState((s) => ({ ...s, loading: true, error: null }))
    try {
      const run = await fetchRun(editId)
      if (!run) {
        setEditState({ loading: false, error: '회차를 찾을 수 없습니다.', expected: null, cancelled: false })
        return
      }
      setLevel(run.boss_level)
      setOccurredInput(toKstInputValue(new Date(run.occurred_at)))
      setNote(run.note ?? '')
      setManual(run.attendances.map((a) => a.member_id))
      setPreset(new Map(run.attendances.map((a) => [a.member_id, a.match_method])))
      setEditState({ loading: false, error: null, expected: run.updated_at, cancelled: !!run.cancelled_at })
    } catch (e) {
      setEditState({ loading: false, error: errorMessage(e), expected: null, cancelled: false })
    }
  }, [editId])

  useEffect(() => {
    void loadEdit()
  }, [loadEdit])

  // ------------------------------------------------------------ 이미지 추가
  const addFiles = useCallback(async (files: File[]) => {
    const errs: string[] = []
    for (const f of files) {
      if (!ACCEPTED_IMAGE_TYPES.includes(f.type)) {
        errs.push(`${f.name || '붙여넣은 항목'}: 지원하지 않는 형식입니다 (PNG, JPG, WEBP, BMP, GIF).`)
        continue
      }
      if (f.size > MAX_IMAGE_BYTES) {
        errs.push(`${f.name}: 파일이 너무 큽니다 (최대 ${MAX_IMAGE_BYTES / 1024 / 1024}MB).`)
        continue
      }
      const url = URL.createObjectURL(f)
      try {
        const img = await loadImage(url)
        if (img.naturalWidth * img.naturalHeight > MAX_IMAGE_PIXELS) {
          URL.revokeObjectURL(url)
          errs.push(`${f.name}: 해상도가 너무 큽니다. 필요한 부분만 캡처하세요.`)
          continue
        }
        const shot: Shot = {
          id: crypto.randomUUID(),
          name: f.name || '붙여넣은 이미지',
          url,
          img,
          width: img.naturalWidth,
          height: img.naturalHeight,
          rect: null,
          state: 'queued',
          progress: 0,
          statusText: '대기 중',
          error: null,
          items: [],
          lineCount: 0,
        }
        setShots((xs) => [...xs, shot])
      } catch {
        URL.revokeObjectURL(url)
        errs.push(`${f.name}: 이미지를 읽을 수 없습니다.`)
      }
    }
    setInputErrors(errs)
  }, [])

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = [...(e.clipboardData?.items ?? [])]
        .filter((i) => i.kind === 'file' && i.type.startsWith('image/'))
        .map((i) => i.getAsFile())
        .filter((f): f is File => !!f)
      if (files.length) {
        e.preventDefault()
        void addFiles(files)
      }
    }
    const stopDrop = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault()
    }
    window.addEventListener('paste', onPaste)
    window.addEventListener('dragover', stopDrop)
    window.addEventListener('drop', stopDrop)
    return () => {
      window.removeEventListener('paste', onPaste)
      window.removeEventListener('dragover', stopDrop)
      window.removeEventListener('drop', stopDrop)
    }
  }, [addFiles])

  useEffect(
    () => () => {
      shotsRef.current.forEach((s) => URL.revokeObjectURL(s.url))
      void cancelOcr()
    },
    [],
  )

  // ------------------------------------------------------------ OCR 큐 (한 번에 하나)
  const patchShot = (id: string, p: Partial<Shot>) => setShots((xs) => xs.map((s) => (s.id === id ? { ...s, ...p } : s)))

  useEffect(() => {
    if (shots.some((s) => s.state === 'running')) return
    const next = shots.find((s) => s.state === 'queued')
    if (!next) return
    patchShot(next.id, { state: 'running', progress: 0, statusText: 'OCR 준비 중', error: null })
    recognizeImage(next.img, next.rect, (p) =>
      patchShot(next.id, { progress: p.progress, statusText: ocrStatusLabel(p.status) }),
    )
      .then((lines) => {
        const items = matchOcrLines(roster.index, lines, next.id)
        patchShot(next.id, { state: 'done', progress: 1, statusText: '완료', items, lineCount: lines.length })
      })
      .catch((e) => {
        if (e instanceof OcrCancelled) patchShot(next.id, { state: 'cancelled', statusText: '취소됨' })
        else
          patchShot(next.id, {
            state: 'error',
            statusText: '실패',
            error: `OCR 실패: ${errorMessage(e)} — 다시 시도하거나 아래에서 직접 추가하세요.`,
          })
      })
    // roster.index 는 OCR 시점의 명단을 사용
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shots])

  const retry = (id: string, rect?: Rect | null) =>
    patchShot(id, { state: 'queued', items: [], error: null, progress: 0, statusText: '대기 중', ...(rect !== undefined ? { rect } : {}) })

  const removeShot = (id: string) => {
    const s = shots.find((x) => x.id === id)
    if (s?.state === 'running') void cancelOcr()
    if (s) URL.revokeObjectURL(s.url)
    setShots((xs) => xs.filter((x) => x.id !== id))
  }

  // ------------------------------------------------------------ 매칭 결과 편집
  const patchItem = (key: string, f: (it: MatchItem) => MatchItem) =>
    setShots((xs) => xs.map((s) => ({ ...s, items: s.items.map((it) => (it.key === key ? f(it) : it)) })))

  const allItems = useMemo(() => shots.flatMap((s) => s.items), [shots])
  const final = useMemo(() => {
    const list = finalAttendees(allItems, manual, roster.index.members)
    return list.map((a) => (preset.has(a.memberId) && a.matchMethod === 'manual' ? { ...a, matchMethod: preset.get(a.memberId)! } : a))
  }, [allItems, manual, roster.index.members, preset])
  const finalIds = useMemo(() => new Set(final.map((f) => f.memberId)), [final])
  const duplicates = final.filter((f) => f.occurrences > 1).length

  const removeAttendee = (memberId: string) => {
    setManual((m) => m.filter((x) => x !== memberId))
    setShots((xs) =>
      xs.map((s) => ({ ...s, items: s.items.map((it) => (it.memberId === memberId ? { ...it, selected: false } : it)) })),
    )
  }

  // ------------------------------------------------------------ 시각/충돌 검사
  const occurredAt = fromKstInputValue(occurredInput)
  const future = occurredAt ? occurredAt.getTime() > Date.now() + 10 * 60 * 1000 : false
  const conflicts = useMemo(() => {
    if (!occurredAt) return []
    return final.filter((a) => {
      const m = roster.byId.get(a.memberId)
      return m ? !activeAt(m, occurredAt) : false
    })
  }, [final, occurredAt, roster.byId])

  const ocrRunning = shots.some((s) => s.state === 'running' || s.state === 'queued')
  const dirty = shots.length > 0 || manual.length > 0 || note !== ''

  useEffect(() => {
    if (!dirty || saved) return
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault()
    }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [dirty, saved])

  const problems: string[] = []
  if (!level) problems.push('보스 레벨을 선택하세요.')
  if (!occurredAt) problems.push('처치 날짜·시간을 입력하세요.')
  if (future) problems.push('처치 시각이 미래입니다.')
  if (final.length === 0) problems.push('참여자를 한 명 이상 선택하세요.')
  if (conflicts.length) problems.push(`처치 시각에 재적 상태가 아닌 길드원 ${conflicts.length}명이 있습니다.`)
  if (editState.cancelled) problems.push('취소된 회차는 복구한 뒤 수정할 수 있습니다.')

  const save = async () => {
    if (savingRef.current || problems.length || !occurredAt || !level) return
    savingRef.current = true
    setSaving(true)
    setSaveError(null)
    try {
      const r = await saveBossRun({
        id: runId,
        bossLevel: level,
        occurredAt: occurredAt.toISOString(),
        note: note.trim() || null,
        attendees: final.map((a) => ({ member_id: a.memberId, match_method: a.matchMethod })),
        expectedUpdatedAt: editId ? editState.expected : null,
      })
      setSaved(true)
      toast('ok', editId ? '회차를 수정했습니다.' : r.created ? '참여 기록을 저장했습니다.' : '이미 저장된 회차입니다. 저장된 내용을 엽니다.')
      shots.forEach((s) => URL.revokeObjectURL(s.url))
      navigate(`/runs/${runId}?saved=${editId ? 'updated' : '1'}`)
    } catch (e) {
      const msg = errorMessage(e)
      setSaveError(
        isMembershipConflict(e)
          ? `${msg} — 해당 길드원의 가입·탈퇴 이력을 고치거나 참여자에서 빼세요.`
          : `${msg} 저장되지 않았습니다. 다시 시도해도 중복 저장되지 않습니다.`,
      )
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  if (editState.loading) return <div className="page"><Loading label="회차 불러오는 중…" /></div>
  if (editState.error)
    return (
      <div className="page">
        <ErrorNotice message={editState.error} onRetry={loadEdit} />
      </div>
    )

  const canCapture = screenCaptureSupported()

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{editId ? '회차 수정' : '참여 기록 작성'}</h1>
          <p>
            캡처 이미지 → OCR → 명단 대조 → 확인 → 레벨·처치 시각 → 저장. 저장 버튼을 누르기 전에는 아무것도 기록되지 않습니다.
          </p>
        </div>
        {editId && (
          <a className="btn" href={href(`/runs/${editId}`)}>
            수정 취소
          </a>
        )}
      </div>

      {roster.error && <ErrorNotice message={`명단을 불러오지 못했습니다: ${roster.error}`} onRetry={roster.reload} />}
      {editState.cancelled && (
        <Notice tone="warn">
          <p>취소된 회차입니다. 회차 상세에서 복구한 뒤 수정하세요.</p>
        </Notice>
      )}

      <div className="grid grid--record">
        {/* ---------------------------------------------------- 왼쪽: 이미지와 OCR */}
        <section className="card" aria-labelledby="img-title">
          <div className="card__head">
            <h2 className="card__title" id="img-title">
              1. 캡처 이미지
            </h2>
            <span className="small muted">이미지는 이 브라우저 안에서만 처리되고 서버에 올라가지 않습니다.</span>
          </div>

          <div
            className={`dropzone${over ? ' is-over' : ''}`}
            onDragOver={(e) => {
              e.preventDefault()
              setOver(true)
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault()
              setOver(false)
              void addFiles([...e.dataTransfer.files])
            }}
          >
            <p className="dropzone__title">
              <span className="kbd">Win</span> + <span className="kbd">Shift</span> + <span className="kbd">S</span> 로 캡처한 뒤{' '}
              <span className="kbd">Ctrl</span> + <span className="kbd">V</span>
            </p>
            <p className="small" style={{ margin: '0 0 10px' }}>
              또는 이미지를 여기로 끌어 놓거나 파일을 고르세요. 여러 장을 한 회차에 추가할 수 있습니다.
            </p>
            <div className="row" style={{ justifyContent: 'center' }}>
              <button type="button" className="btn btn--sm" onClick={() => fileRef.current?.click()}>
                이미지 파일 선택
              </button>
              {canCapture && <ScreenCapture onCapture={(f) => void addFiles([f])} />}
            </div>
            {!canCapture && (
              <p className="small muted" style={{ margin: '8px 0 0' }}>
                이 기기에서는 화면 공유 캡처를 지원하지 않습니다. 이미지 업로드를 사용하세요.
              </p>
            )}
            <input
              ref={fileRef}
              type="file"
              accept={ACCEPTED_IMAGE_TYPES.join(',')}
              multiple
              hidden
              onChange={(e) => {
                void addFiles([...(e.target.files ?? [])])
                e.target.value = ''
              }}
            />
          </div>

          {inputErrors.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <Notice tone="error">
                {inputErrors.map((m) => (
                  <p key={m}>{m}</p>
                ))}
              </Notice>
            </div>
          )}

          <div className="shots">
            {shots.map((s, i) => (
              <article key={s.id} className="shot" aria-label={`이미지 ${i + 1}`}>
                <div className="shot__head">
                  <span className="shot__name" title={s.name}>
                    {i + 1}. {s.name} <span className="muted">({s.width}×{s.height})</span>
                  </span>
                  <div className="row">
                    {s.rect && (
                      <button type="button" className="btn btn--sm btn--ghost" onClick={() => retry(s.id, null)}>
                        영역 해제 후 전체 인식
                      </button>
                    )}
                    {s.state === 'running' ? (
                      <button type="button" className="btn btn--sm" onClick={() => void cancelOcr()}>
                        OCR 취소
                      </button>
                    ) : (
                      <button type="button" className="btn btn--sm" onClick={() => retry(s.id)} disabled={s.state === 'queued'}>
                        OCR 다시 시도
                      </button>
                    )}
                    <button type="button" className="btn btn--sm btn--danger" onClick={() => removeShot(s.id)}>
                      제거
                    </button>
                  </div>
                </div>
                <RegionSelector
                  src={s.url}
                  naturalWidth={s.width}
                  naturalHeight={s.height}
                  value={s.rect}
                  onChange={(r) => retry(s.id, r)}
                  alt={`캡처 이미지 ${i + 1}`}
                />
                <p className="small muted" style={{ margin: '6px 0' }}>
                  닉네임 목록 부분만 드래그해 영역을 지정하면 그 영역으로 다시 인식합니다.
                  {s.rect && ` (현재 영역 ${s.rect.w}×${s.rect.h})`}
                </p>
                {(s.state === 'running' || s.state === 'queued') && (
                  <div role="status" aria-live="polite">
                    <div className="row row--between small">
                      <span>{s.statusText}</span>
                      <span className="num">{Math.round(s.progress * 100)}%</span>
                    </div>
                    <div className="progress" aria-hidden="true">
                      <div className="progress__bar" style={{ width: `${Math.round(s.progress * 100)}%` }} />
                    </div>
                  </div>
                )}
                {s.state === 'error' && <ErrorNotice message={s.error ?? 'OCR 실패'} onRetry={() => retry(s.id)} />}
                {s.state === 'cancelled' && (
                  <Notice tone="warn">
                    <p>OCR을 취소했습니다. “OCR 다시 시도”로 재개하거나 직접 추가하세요.</p>
                  </Notice>
                )}
                {s.state === 'done' && s.items.length === 0 && (
                  <Notice tone="warn">
                    <p>인식된 글자가 없습니다 ({s.lineCount}줄). 영역을 지정해 다시 시도하거나 직접 추가하세요.</p>
                  </Notice>
                )}
              </article>
            ))}
          </div>

          {allItems.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div className="card__head">
                <h2 className="card__title">2. 인식 결과 확인</h2>
                <span className="small muted">OCR 신뢰도와 닉네임 유사도는 서로 다른 값입니다.</span>
              </div>
              <ul className="match-list">
                {allItems.map((it) => (
                  <MatchRow
                    key={it.key}
                    item={it}
                    shotNo={shots.findIndex((s) => s.id === it.sourceId) + 1}
                    onToggle={() => patchItem(it.key, (x) => ({ ...x, selected: !x.selected }))}
                    onLink={(memberId) =>
                      patchItem(it.key, (x) => ({
                        ...x,
                        memberId,
                        selected: true,
                        // 자동 일치 결과를 다른 사람으로 바꾸면 더 이상 자동 일치가 아니다 (수동 확인으로 저장)
                        status: x.memberId !== memberId && (x.status === 'exact' || x.status === 'alias') ? 'review' : x.status,
                      }))
                    }
                    onExclude={() => patchItem(it.key, (x) => ({ ...x, status: 'excluded', selected: false }))}
                    onRestore={() =>
                      patchItem(it.key, (x) => ({
                        ...x,
                        status: x.originalStatus,
                        selected: x.originalStatus === 'exact' || x.originalStatus === 'alias' || !!x.memberId,
                      }))
                    }
                  />
                ))}
              </ul>
            </div>
          )}
        </section>

        {/* ---------------------------------------------------- 오른쪽: 최종 명단과 저장 */}
        <section className="card" aria-labelledby="final-title" style={{ position: 'sticky', top: 'calc(var(--nav-h) + 12px)' }}>
          <div className="card__head">
            <h2 className="card__title" id="final-title">
              3. 최종 참여자 <span className="num">{final.length}</span>명
            </h2>
            {ocrRunning && (
              <span className="small muted">
                <span className="spinner" aria-hidden="true" /> OCR 진행 중
              </span>
            )}
          </div>
          <div className="field">
            <span className="field__label">길드원 검색 후 직접 추가</span>
            <MemberSearch
              onSelect={(m) => setManual((xs) => (xs.includes(m.id) ? xs : [...xs, m.id]))}
              exclude={finalIds}
              label="참여자 직접 추가"
            />
          </div>
          {final.length === 0 ? (
            <p className="small muted">아직 선택된 참여자가 없습니다. OCR 결과를 체크하거나 직접 추가하세요.</p>
          ) : (
            <ul className="attendee-list" aria-label="최종 참여자">
              {final.map((a) => {
                const bad = conflicts.some((c) => c.memberId === a.memberId)
                return (
                  <li key={a.memberId} className={`chip${bad ? ' chip--warn' : ''}`}>
                    {bad && <span aria-hidden="true">⚠</span>}
                    <span>{a.nickname}</span>
                    {bad && <span className="sr-only">(처치 시각에 재적 아님)</span>}
                    <span className="small muted">
                      {a.matchMethod === 'exact' ? '정확' : a.matchMethod === 'alias' ? '별칭' : '수동'}
                    </span>
                    <button type="button" aria-label={`${a.nickname} 빼기`} onClick={() => removeAttendee(a.memberId)}>
                      ✕
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
          {duplicates > 0 && (
            <p className="small muted" style={{ marginTop: 8 }}>
              여러 이미지·줄에서 중복으로 발견된 {duplicates}명은 한 번만 집계됩니다.
            </p>
          )}
          {conflicts.length > 0 && occurredAt && (
            <div style={{ marginTop: 10 }}>
              <Notice tone="warn">
                <p>
                  {formatKst(occurredAt)} 에 재적 상태가 아닌 길드원: {conflicts.map((c) => c.nickname).join(', ')}
                </p>
                <p className="small">
                  처치 시각을 확인하거나, 참여자에서 빼거나,{' '}
                  {conflicts.map((c, i) => (
                    <span key={c.memberId}>
                      {i > 0 && ', '}
                      <a href={href(`/members?edit=${c.memberId}`)} target="_blank" rel="noreferrer">
                        {c.nickname} 가입 이력 수정
                      </a>
                    </span>
                  ))}{' '}
                  후 다시 확인하세요.
                </p>
                <button type="button" className="btn btn--sm" onClick={() => void roster.reload()}>
                  명단 새로고침
                </button>
              </Notice>
            </div>
          )}

          <hr style={{ border: 0, borderTop: '1px solid var(--line)', margin: '16px 0' }} />

          <div className="field">
            <span className="field__label" id="level-label">
              4. 보스 레벨
            </span>
            <div className="level-picker" role="group" aria-labelledby="level-label">
              {BOSS_LEVELS.map((l) => (
                <button key={l} type="button" aria-pressed={level === l} onClick={() => setLevel(l)}>
                  {l}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <label htmlFor="occurred">실제 처치 날짜·시간 (한국 시각)</label>
            <div className="row">
              <input
                id="occurred"
                className="input"
                type="datetime-local"
                style={{ flex: 1, minWidth: 200 }}
                value={occurredInput}
                onChange={(e) => setOccurredInput(e.target.value)}
                aria-invalid={!occurredAt || future}
              />
              <button type="button" className="btn btn--sm" onClick={() => setOccurredInput(toKstInputValue(new Date()))}>
                지금
              </button>
            </div>
            {occurredAt && <span className="field__hint">{formatKst(occurredAt)} KST</span>}
          </div>
          <div className="field">
            <label htmlFor="note">메모 (선택)</label>
            <input
              id="note"
              className="input"
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="예: 2채널, 늦게 합류한 인원 확인"
            />
          </div>

          <div className="sticky-save">
            {saveError && <ErrorNotice message={saveError} />}
            {problems.length > 0 && final.length + (level ? 1 : 0) > 0 && (
              <ul className="small muted" style={{ margin: '0 0 8px', paddingLeft: 18 }}>
                {problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
            <div className="row row--between">
              <span className="small">
                {level ? <LevelBadge level={level} /> : <span className="muted">레벨 미선택</span>}{' '}
                <span className="strong num">{final.length}명</span>
              </span>
              <button
                type="button"
                className="btn btn--primary btn--hero"
                onClick={save}
                disabled={saving || problems.length > 0}
                aria-busy={saving}
              >
                {saving && <span className="spinner" aria-hidden="true" />}
                {saving ? '저장 중…' : editId ? '수정 저장' : '저장'}
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}

function MatchRow({
  item,
  shotNo,
  onToggle,
  onLink,
  onExclude,
  onRestore,
}: {
  item: MatchItem
  shotNo: number
  onToggle: () => void
  onLink: (memberId: string) => void
  onExclude: () => void
  onRestore: () => void
}) {
  const roster = useRoster()
  const [picking, setPicking] = useState(false)
  const linked = item.memberId ? roster.byId.get(item.memberId) : null
  const excluded = item.status === 'excluded'
  const auto = (item.status === 'exact' || item.status === 'alias') && item.originalStatus === item.status
  return (
    <li className={`match${excluded ? ' match--excluded' : ''}`}>
      <input
        type="checkbox"
        className="checkbox"
        style={{ width: 18, height: 18, accentColor: 'var(--gold)' }}
        checked={item.selected}
        disabled={excluded || !item.memberId}
        onChange={onToggle}
        aria-label={`${item.cleaned} 참여 포함`}
      />
      <div className="match__body">
        <div className="row" style={{ gap: 6 }}>
          <MatchBadge status={item.status} />
          <span className="match__raw">“{item.raw}”</span>
        </div>
        <div className="match__meta">
          이미지 {shotNo} · OCR 신뢰도 {item.ocrConfidence ?? '-'}%
          {linked && (
            <>
              {' '}
              → <span className="strong">{linked.nickname}</span>
              {!auto && ' (관리자 확인)'}
            </>
          )}
          {item.conflict && <span style={{ color: 'var(--warn)' }}> · {item.conflict} — 자동 매칭 차단</span>}
        </div>
        {!excluded && !auto && item.suggestions.length > 0 && !item.memberId && (
          <div className="row" style={{ gap: 4, marginTop: 4 }}>
            <span className="small muted">추천:</span>
            {item.suggestions.map((s) => (
              <button key={s.memberId} type="button" className="btn btn--sm" onClick={() => onLink(s.memberId)}>
                {s.nickname} <span className="muted num">유사도 {Math.round(s.score * 100)}%</span>
              </button>
            ))}
          </div>
        )}
        {picking && (
          <div style={{ marginTop: 6 }}>
            <MemberSearch
              autoFocus
              label="연결할 길드원 검색"
              onSelect={(m) => {
                onLink(m.id)
                setPicking(false)
              }}
            />
          </div>
        )}
      </div>
      <div className="row" style={{ gap: 4 }}>
        {!excluded && (
          <button type="button" className="btn btn--sm btn--ghost" onClick={() => setPicking((p) => !p)}>
            {item.memberId ? '연결 변경' : '길드원 연결'}
          </button>
        )}
        {excluded ? (
          <button type="button" className="btn btn--sm btn--ghost" onClick={onRestore}>
            되돌리기
          </button>
        ) : (
          <button type="button" className="btn btn--sm btn--ghost" onClick={onExclude}>
            제외
          </button>
        )}
      </div>
    </li>
  )
}
