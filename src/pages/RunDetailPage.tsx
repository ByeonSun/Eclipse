import { useCallback, useEffect, useState } from 'react'
import { Empty, ErrorNotice, LevelBadge, Loading, Notice, useLatest, useToast } from '../components/ui'
import { fetchRun, setRunCancelled, type RunDetail } from '../lib/api'
import { errorMessage } from '../lib/errors'
import { href, useRoute } from '../lib/router'
import { formatKst } from '../lib/time'

const METHOD_LABEL = { exact: '정확 일치', alias: '별칭 일치', manual: '수동 확인' } as const

export function RunDetailPage({ id }: { id: string }) {
  const route = useRoute()
  const toast = useToast()
  const latest = useLatest()
  const [run, setRun] = useState<RunDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const saved = route.query.get('saved')

  const load = useCallback(async () => {
    const isLatest = latest()
    setLoading(true)
    setError(null)
    try {
      const r = await fetchRun(id)
      if (isLatest()) setRun(r)
    } catch (e) {
      if (isLatest()) setError(errorMessage(e))
    } finally {
      if (isLatest()) setLoading(false)
    }
  }, [id, latest])

  useEffect(() => {
    void load()
  }, [load])

  const toggleCancel = async () => {
    if (!run) return
    const cancelling = !run.cancelled_at
    const ok = window.confirm(
      cancelling
        ? '이 회차를 취소할까요? 기록은 보존되지만 참여율 계산에서 빠집니다.'
        : '이 회차를 복구할까요? 다시 참여율 계산에 포함됩니다.',
    )
    if (!ok) return
    setBusy(true)
    try {
      await setRunCancelled(run.id, cancelling)
      toast('ok', cancelling ? '회차를 취소했습니다.' : '회차를 복구했습니다.')
      await load()
    } catch (e) {
      toast('error', errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  if (loading && !run) return <div className="page"><Loading /></div>
  if (error) return <div className="page"><ErrorNotice message={error} onRetry={load} /></div>
  if (!run)
    return (
      <div className="page">
        <Empty title="회차를 찾을 수 없습니다">
          <a className="btn" href={href('/history')}>
            이력으로
          </a>
        </Empty>
      </div>
    )

  return (
    <div className="page page--narrow">
      {saved && (
        <Notice tone="ok" live>
          <p>
            {saved === 'updated' ? '수정 내용을 저장했습니다.' : '참여 기록을 저장했습니다.'} 참여율과 이력에 바로 반영됩니다.
          </p>
        </Notice>
      )}
      <div className="page-head">
        <div>
          <h1>
            <LevelBadge level={run.boss_level} /> {formatKst(run.occurred_at)}
          </h1>
          <p>
            보스 회차 상세 ·{' '}
            {run.cancelled_at ? (
              <span className="badge badge--danger">
                <span aria-hidden="true">✕</span> 취소됨 ({formatKst(run.cancelled_at)})
              </span>
            ) : (
              <span className="badge badge--ok">
                <span aria-hidden="true">✓</span> 유효
              </span>
            )}
          </p>
        </div>
        <div className="page-head__actions">
          <a className="btn btn--primary" href={href('/record/new')}>
            새 기록 추가
          </a>
          {!run.cancelled_at && (
            <a className="btn" href={href(`/runs/${run.id}/edit`)}>
              수정
            </a>
          )}
          <button type="button" className={`btn${run.cancelled_at ? '' : ' btn--danger'}`} onClick={toggleCancel} disabled={busy}>
            {run.cancelled_at ? '복구' : '회차 취소'}
          </button>
        </div>
      </div>

      <div className="card">
        <dl className="dl">
          <dt>보스 레벨</dt>
          <dd>{run.boss_level}</dd>
          <dt>처치 시각</dt>
          <dd>{formatKst(run.occurred_at, { seconds: false })} (한국 시각)</dd>
          <dt>참여 인원</dt>
          <dd className="num">{run.attendances.length}명</dd>
          <dt>메모</dt>
          <dd>{run.note || <span className="muted">없음</span>}</dd>
          <dt>기록 생성</dt>
          <dd>
            {formatKst(run.created_at)} · admin <span className="muted small">({run.created_by.slice(0, 8)})</span>
          </dd>
          <dt>마지막 수정</dt>
          <dd>
            {formatKst(run.updated_at)} · admin <span className="muted small">({run.updated_by.slice(0, 8)})</span>
          </dd>
        </dl>
      </div>

      <div className="card">
        <div className="card__head">
          <h2 className="card__title">참여자 {run.attendances.length}명</h2>
          <span className="small muted">당시 닉네임 기준, 바뀐 경우 현재 닉네임을 함께 표시</span>
        </div>
        {run.attendances.length === 0 ? (
          <Empty title="참여자가 없습니다" />
        ) : (
          <div className="table-wrap" style={{ maxHeight: 'none' }}>
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">당시 닉네임</th>
                  <th scope="col">현재 닉네임</th>
                  <th scope="col">확인 방식</th>
                </tr>
              </thead>
              <tbody>
                {run.attendances.map((a) => (
                  <tr key={a.member_id}>
                    <td>
                      <a className="row-link" href={href(`/members/${a.member_id}`)}>
                        {a.nickname_snapshot}
                      </a>
                    </td>
                    <td>
                      {a.members && a.members.nickname !== a.nickname_snapshot ? (
                        a.members.nickname
                      ) : (
                        <span className="muted">같음</span>
                      )}
                    </td>
                    <td>{METHOD_LABEL[a.match_method]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
