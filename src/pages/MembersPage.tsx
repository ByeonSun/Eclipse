import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Dialog, Empty, ErrorNotice, Loading, MemberStatusBadge, Notice, useToast } from '../components/ui'
import { useRoster } from '../data/RosterProvider'
import {
  addAlias,
  addPeriod,
  createMembers,
  deleteAlias,
  deleteMember,
  deletePeriod,
  memberHasAttendance,
  memberStatus,
  renameMember,
  setArchived,
  updatePeriod,
  type Member,
  type PeriodRow,
} from '../lib/api'
import { csvBlob, downloadBlob } from '../lib/csv'
import { errorMessage } from '../lib/errors'
import { parseMemberCsv, parseNicknameList, validateImportRows, type ImportRow } from '../lib/memberImport'
import { normalizeName } from '../lib/normalize'
import { href, navigate, useRoute } from '../lib/router'
import { formatKst, fromKstInputValue, kstDateString, toKstInputValue } from '../lib/time'

type Tab = 'list' | 'bulk' | 'csv'
type StatusFilter = 'all' | 'active' | 'left' | 'archived'

export function MembersPage() {
  const route = useRoute()
  const roster = useRoster()
  const [tab, setTab] = useState<Tab>('list')
  const editId = route.query.get('edit')
  const editing = editId ? roster.byId.get(editId) : undefined

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>길드원 관리</h1>
          <p>닉네임은 길드원 ID와 분리되어 있어, 닉네임을 바꿔도 과거 참여 기록은 같은 길드원에게 남습니다.</p>
        </div>
        <div className="page-head__actions">
          <button
            type="button"
            className="btn"
            disabled={!roster.members.length}
            onClick={() => exportMembers(roster.members)}
          >
            명단 CSV 내보내기
          </button>
        </div>
      </div>

      <div className="tabs" role="tablist" aria-label="길드원 관리">
        {(
          [
            ['list', '명단'],
            ['bulk', '일괄 붙여넣기'],
            ['csv', 'CSV 가져오기'],
          ] as const
        ).map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>

      {roster.error && <ErrorNotice message={roster.error} onRetry={roster.reload} />}
      {tab === 'list' && <MemberList onEdit={(m) => navigate(`/members?edit=${m.id}`)} />}
      {tab === 'bulk' && <BulkImport onDone={() => setTab('list')} />}
      {tab === 'csv' && <CsvImport onDone={() => setTab('list')} />}

      <Dialog open={!!editing} title={editing ? `길드원 정보 · ${editing.nickname}` : ''} onClose={() => navigate('/members')} wide>
        {editing && <MemberEditor member={editing} />}
      </Dialog>
      {editId && !editing && !roster.loading && (
        <Notice tone="warn">
          <p>수정할 길드원을 찾을 수 없습니다.</p>
        </Notice>
      )}
    </div>
  )
}

function exportMembers(members: Member[]) {
  const rows: (string | null)[][] = [['닉네임', '가입일시', '탈퇴일시', '별칭', '상태', 'member_id']]
  for (const m of members) {
    const aliases = m.member_aliases.map((a) => a.alias).join('|')
    const periods = m.membership_periods.length ? m.membership_periods : [null]
    for (const p of periods) {
      rows.push([
        m.nickname,
        p ? formatKst(p.joined_at, { weekday: false }) : '',
        p?.left_at ? formatKst(p.left_at, { weekday: false }) : '',
        aliases,
        memberStatus(m).label,
        m.id,
      ])
    }
  }
  downloadBlob(csvBlob(rows), `하이-길드원-${kstDateString(new Date())}.csv`)
}

// ---------------------------------------------------------------------------
// 명단 + 한 명 등록
// ---------------------------------------------------------------------------
function MemberList({ onEdit }: { onEdit: (m: Member) => void }) {
  const roster = useRoster()
  const toast = useToast()
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<StatusFilter>('active')
  const [nick, setNick] = useState('')
  const [joined, setJoined] = useState(() => toKstInputValue(new Date()))
  const [aliases, setAliases] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const list = useMemo(() => {
    const key = normalizeName(q)
    return roster.members.filter((m) => {
      const st = memberStatus(m).tone
      if (status === 'active' && st !== 'active' && st !== 'pending') return false
      if (status === 'left' && st !== 'left') return false
      if (status === 'archived' && st !== 'archived') return false
      if (!key) return true
      return normalizeName(m.nickname).includes(key) || m.member_aliases.some((a) => normalizeName(a.alias).includes(key))
    })
  }, [roster.members, q, status])

  const add = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    const at = fromKstInputValue(joined)
    if (!nick.trim()) return setError('닉네임을 입력하세요.')
    if (!at) return setError('가입 시각을 확인하세요.')
    const aliasList = aliases
      .split(',')
      .map((a) => a.trim())
      .filter(Boolean)
    const checked = validateImportRows(
      [{ line: 1, nickname: nick.trim(), joinedAt: at, leftAt: null, aliases: aliasList, errors: [], warnings: [] }],
      existingNames(roster.members),
    )[0]
    if (checked.errors.length) return setError(checked.errors.join(' '))
    setBusy(true)
    try {
      await createMembers([{ nickname: nick.trim(), joined_at: at.toISOString(), aliases: aliasList }])
      toast('ok', `${nick.trim()} 님을 등록했습니다.`)
      setNick('')
      setAliases('')
      await roster.reload()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <form className="card" onSubmit={add} style={{ marginBottom: 14 }}>
        <div className="card__head">
          <h2 className="card__title">한 명 등록</h2>
        </div>
        {error && <ErrorNotice message={error} />}
        <div className="row" style={{ alignItems: 'flex-end', gap: 12 }}>
          <div className="field mb-0" style={{ flex: '1 1 180px' }}>
            <label htmlFor="new-nick">닉네임</label>
            <input id="new-nick" className="input" maxLength={40} value={nick} onChange={(e) => setNick(e.target.value)} />
          </div>
          <div className="field mb-0">
            <label htmlFor="new-joined">가입 시각 (KST)</label>
            <input id="new-joined" className="input" type="datetime-local" value={joined} onChange={(e) => setJoined(e.target.value)} />
          </div>
          <div className="field mb-0" style={{ flex: '1 1 200px' }}>
            <label htmlFor="new-aliases">OCR 별칭 (쉼표로 구분, 선택)</label>
            <input id="new-aliases" className="input" value={aliases} onChange={(e) => setAliases(e.target.value)} />
          </div>
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {busy ? '등록 중…' : '등록'}
          </button>
        </div>
      </form>

      <div className="row" style={{ marginBottom: 10, gap: 12 }}>
        <label className="sr-only" htmlFor="m-search">
          닉네임 검색
        </label>
        <input
          id="m-search"
          className="input"
          style={{ maxWidth: 280 }}
          type="search"
          placeholder="닉네임·별칭 검색"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="segmented" role="group" aria-label="상태 필터">
          {(
            [
              ['active', '재적'],
              ['left', '탈퇴'],
              ['archived', '비활성'],
              ['all', '전체'],
            ] as const
          ).map(([k, label]) => (
            <button key={k} type="button" aria-pressed={status === k} onClick={() => setStatus(k)}>
              {label}
            </button>
          ))}
        </div>
        <span className="small muted">{list.length}명</span>
      </div>

      {roster.loading && !roster.members.length ? (
        <Loading />
      ) : list.length === 0 ? (
        <div className="card">
          <Empty title={roster.members.length ? '조건에 맞는 길드원이 없습니다' : '등록된 길드원이 없습니다'}>
            {!roster.members.length && <p>위에서 한 명씩 등록하거나 “일괄 붙여넣기”, “CSV 가져오기”를 사용하세요.</p>}
          </Empty>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">닉네임</th>
                <th scope="col">상태</th>
                <th scope="col">별칭</th>
                <th scope="col">가입·탈퇴 이력 (KST)</th>
                <th scope="col">
                  <span className="sr-only">관리</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {list.map((m) => (
                <tr key={m.id}>
                  <td>
                    <a className="row-link" href={href(`/members/${m.id}`)}>
                      {m.nickname}
                    </a>
                  </td>
                  <td>
                    <MemberStatusBadge {...memberStatus(m)} />
                  </td>
                  <td style={{ whiteSpace: 'normal' }}>{m.member_aliases.map((a) => a.alias).join(', ') || <span className="muted">-</span>}</td>
                  <td className="small" style={{ whiteSpace: 'normal' }}>
                    {m.membership_periods
                      .map((p) => `${kstDateString(new Date(p.joined_at))} ~ ${p.left_at ? kstDateString(new Date(p.left_at)) : '현재'}`)
                      .join(' / ')}
                  </td>
                  <td>
                    <button type="button" className="btn btn--sm" onClick={() => onEdit(m)}>
                      관리
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

function existingNames(members: Member[]) {
  return members.flatMap((m) => [
    { key: normalizeName(m.nickname), owner: m.nickname },
    ...m.member_aliases.map((a) => ({ key: normalizeName(a.alias), owner: `${m.nickname}(별칭)` })),
  ])
}

// ---------------------------------------------------------------------------
// 가져오기 미리보기 (일괄 / CSV 공용)
// ---------------------------------------------------------------------------
function ImportPreview({ rows, onDone, onReset }: { rows: ImportRow[]; onDone: () => void; onReset: () => void }) {
  const roster = useRoster()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const checked = useMemo(() => validateImportRows(rows, existingNames(roster.members)), [rows, roster.members])
  const ok = checked.filter((r) => r.errors.length === 0)
  const bad = checked.length - ok.length

  const run = async () => {
    setBusy(true)
    setError(null)
    try {
      for (let i = 0; i < ok.length; i += 500) {
        await createMembers(
          ok.slice(i, i + 500).map((r) => ({
            nickname: r.nickname,
            joined_at: r.joinedAt!.toISOString(),
            left_at: r.leftAt?.toISOString() ?? null,
            aliases: r.aliases,
          })),
        )
      }
      toast('ok', `${ok.length}명을 등록했습니다.`)
      await roster.reload()
      onDone()
    } catch (e) {
      setError(`${errorMessage(e)} — 등록은 모두 취소되었습니다(부분 등록 없음).`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="card__head">
        <h2 className="card__title">
          미리보기 · 정상 {ok.length}명{bad > 0 && <span style={{ color: 'var(--danger)' }}> · 오류 {bad}행</span>}
        </h2>
        <div className="row">
          <button type="button" className="btn btn--sm" onClick={onReset}>
            다시 입력
          </button>
          <button type="button" className="btn btn--primary btn--sm" disabled={busy || ok.length === 0} onClick={run}>
            {busy ? '등록 중…' : `정상 ${ok.length}명 등록`}
          </button>
        </div>
      </div>
      {error && <ErrorNotice message={error} />}
      {bad > 0 && (
        <Notice tone="warn">
          <p>오류가 있는 행은 등록되지 않습니다. 원본을 고친 뒤 다시 가져오거나, 정상 행만 등록하세요.</p>
        </Notice>
      )}
      <div className="table-wrap" style={{ maxHeight: 420 }}>
        <table className="table">
          <thead>
            <tr>
              <th scope="col" className="num">
                행
              </th>
              <th scope="col">닉네임</th>
              <th scope="col">가입</th>
              <th scope="col">탈퇴</th>
              <th scope="col">별칭</th>
              <th scope="col">확인</th>
            </tr>
          </thead>
          <tbody>
            {checked.map((r) => (
              <tr key={r.line}>
                <td className="num">{r.line}</td>
                <td>{r.nickname || <span className="muted">(빈 값)</span>}</td>
                <td>{r.joinedAt ? formatKst(r.joinedAt, { weekday: false }) : '-'}</td>
                <td>{r.leftAt ? formatKst(r.leftAt, { weekday: false }) : '-'}</td>
                <td>{r.aliases.join(', ')}</td>
                <td style={{ whiteSpace: 'normal' }}>
                  {r.errors.length ? (
                    <span style={{ color: 'var(--danger)' }}>
                      <span aria-hidden="true">✕ </span>
                      {r.errors.join(' / ')}
                    </span>
                  ) : (
                    <span style={{ color: 'var(--ok)' }}>
                      <span aria-hidden="true">✓ </span>정상
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function BulkImport({ onDone }: { onDone: () => void }) {
  const [text, setText] = useState('')
  const [joined, setJoined] = useState(() => toKstInputValue(new Date()))
  const [rows, setRows] = useState<ImportRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const preview = () => {
    const at = fromKstInputValue(joined)
    if (!at) return setError('가입 시각을 확인하세요.')
    const parsed = parseNicknameList(text, at)
    if (!parsed.length) return setError('닉네임을 한 줄에 하나씩 붙여넣으세요.')
    setError(null)
    setRows(parsed)
  }
  return (
    <>
      <div className="card">
        <div className="field">
          <label htmlFor="bulk-text">닉네임 목록 (한 줄에 한 명)</label>
          <textarea
            id="bulk-text"
            className="textarea"
            rows={10}
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              setRows(null)
            }}
          />
        </div>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <div className="field mb-0">
            <label htmlFor="bulk-joined">공통 가입 시각 (KST)</label>
            <input id="bulk-joined" className="input" type="datetime-local" value={joined} onChange={(e) => setJoined(e.target.value)} />
          </div>
          <button type="button" className="btn btn--primary" onClick={preview}>
            미리보기
          </button>
        </div>
        {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
      </div>
      {rows && <ImportPreview rows={rows} onDone={onDone} onReset={() => setRows(null)} />}
    </>
  )
}

function CsvImport({ onDone }: { onDone: () => void }) {
  const [rows, setRows] = useState<ImportRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const onFile = async (f: File | undefined) => {
    if (!f) return
    if (f.size > 2 * 1024 * 1024) return setError('CSV 파일이 너무 큽니다 (최대 2MB).')
    const text = await f.text()
    const r = parseMemberCsv(text)
    if (r.error) {
      setError(r.error)
      setRows(null)
    } else {
      setError(null)
      setRows(r.rows)
    }
  }
  const template = () =>
    downloadBlob(
      csvBlob([
        ['닉네임', '가입일', '탈퇴일', '별칭'],
        ['예시닉네임', '2026-01-01', '', '예시별칭1|예시별칭2'],
      ]),
      '하이-길드원-양식.csv',
    )
  return (
    <>
      <div className="card">
        <p className="card__hint" style={{ marginBottom: 12 }}>
          첫 줄 머리글: <code>닉네임, 가입일, 탈퇴일, 별칭</code> · 날짜는 <code>YYYY-MM-DD</code> 또는{' '}
          <code>YYYY-MM-DD HH:mm</code>(한국 시각) · 별칭은 <code>|</code> 로 구분 · UTF-8(엑셀 “CSV UTF-8”) 권장
        </p>
        <div className="row">
          <label className="btn" htmlFor="csv-file">
            CSV 파일 선택
          </label>
          <input id="csv-file" type="file" accept=".csv,text/csv" hidden onChange={(e) => void onFile(e.target.files?.[0])} />
          <button type="button" className="btn btn--ghost" onClick={template}>
            양식 내려받기
          </button>
        </div>
        {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
      </div>
      {rows && <ImportPreview rows={rows} onDone={onDone} onReset={() => setRows(null)} />}
    </>
  )
}

// ---------------------------------------------------------------------------
// 한 명 편집: 닉네임 변경, 별칭, 가입·탈퇴, 비활성/삭제
// ---------------------------------------------------------------------------
function MemberEditor({ member }: { member: Member }) {
  const roster = useRoster()
  const toast = useToast()
  const [nick, setNick] = useState(member.nickname)
  const [keepAlias, setKeepAlias] = useState(true)
  const [alias, setAlias] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setNick(member.nickname)
  }, [member.nickname])

  const act = async (fn: () => Promise<unknown>, okMsg: string) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
      toast('ok', okMsg)
      await roster.reload()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const open = member.membership_periods.find((p) => !p.left_at)

  return (
    <div>
      {error && <ErrorNotice message={error} />}
      <section style={{ marginBottom: 18 }}>
        <h3 className="card__title" style={{ marginBottom: 8 }}>
          닉네임 변경
        </h3>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault()
            if (!nick.trim() || nick.trim() === member.nickname) return
            void act(() => renameMember(member.id, nick.trim(), keepAlias), '닉네임을 변경했습니다.')
          }}
        >
          <label className="sr-only" htmlFor="ed-nick">
            새 닉네임
          </label>
          <input id="ed-nick" className="input" style={{ maxWidth: 260 }} maxLength={40} value={nick} onChange={(e) => setNick(e.target.value)} />
          <label className="checkbox small">
            <input type="checkbox" checked={keepAlias} onChange={(e) => setKeepAlias(e.target.checked)} />
            이전 닉네임을 OCR 별칭으로 남기기
          </label>
          <button type="submit" className="btn btn--sm" disabled={busy || !nick.trim() || nick.trim() === member.nickname}>
            변경
          </button>
        </form>
        <p className="small muted">과거 기록은 그대로 이 길드원에게 연결되고, 기록 당시 닉네임도 회차 상세에 남습니다.</p>
      </section>

      <section style={{ marginBottom: 18 }}>
        <h3 className="card__title" style={{ marginBottom: 8 }}>
          OCR 별칭
        </h3>
        <ul className="attendee-list" style={{ marginBottom: 8 }}>
          {member.member_aliases.length === 0 && <li className="small muted">등록된 별칭이 없습니다.</li>}
          {member.member_aliases.map((a) => (
            <li key={a.id} className="chip">
              {a.alias}
              <button
                type="button"
                aria-label={`별칭 ${a.alias} 삭제`}
                disabled={busy}
                onClick={() => void act(() => deleteAlias(a.id), '별칭을 삭제했습니다.')}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault()
            if (!alias.trim()) return
            const v = alias.trim()
            void act(async () => {
              await addAlias(member.id, v)
              setAlias('')
            }, '별칭을 추가했습니다.')
          }}
        >
          <label className="sr-only" htmlFor="ed-alias">
            새 별칭
          </label>
          <input
            id="ed-alias"
            className="input"
            style={{ maxWidth: 260 }}
            maxLength={40}
            placeholder="OCR이 자주 틀리게 읽는 형태"
            value={alias}
            onChange={(e) => setAlias(e.target.value)}
          />
          <button type="submit" className="btn btn--sm" disabled={busy || !alias.trim()}>
            별칭 추가
          </button>
        </form>
        <p className="small muted">별칭은 다른 길드원의 닉네임·별칭과 겹칠 수 없습니다(DB에서 확인).</p>
      </section>

      <section style={{ marginBottom: 18 }}>
        <div className="row row--between" style={{ marginBottom: 8 }}>
          <h3 className="card__title">가입·탈퇴 이력</h3>
          <div className="row">
            {open ? (
              <button
                type="button"
                className="btn btn--sm"
                disabled={busy}
                onClick={() => {
                  if (window.confirm(`${member.nickname} 님을 지금 시각으로 탈퇴 처리할까요? 과거 기록은 보존됩니다.`))
                    void act(() => updatePeriod(open.id, open.joined_at, new Date().toISOString()), '탈퇴 처리했습니다.')
                }}
              >
                지금 탈퇴 처리
              </button>
            ) : (
              <button
                type="button"
                className="btn btn--sm"
                disabled={busy}
                onClick={() => void act(() => addPeriod(member.id, new Date().toISOString(), null), '재가입 처리했습니다.')}
              >
                지금 재가입
              </button>
            )}
          </div>
        </div>
        <p className="small muted" style={{ marginTop: 0 }}>
          재적 구간은 가입 시각 포함, 탈퇴 시각 제외입니다. 구간끼리 겹칠 수 없고, 이미 저장된 참여 기록을 재적 밖으로 밀어내는 변경은
          거부됩니다.
        </p>
        {member.membership_periods.map((p) => (
          <PeriodEditor key={p.id} period={p} busy={busy} act={act} canDelete={member.membership_periods.length > 1} />
        ))}
        <AddPeriod memberId={member.id} busy={busy} act={act} />
      </section>

      <section>
        <h3 className="card__title" style={{ marginBottom: 8 }}>
          비활성 / 삭제
        </h3>
        <div className="row">
          <button
            type="button"
            className="btn btn--sm"
            disabled={busy}
            onClick={() =>
              void act(
                () => setArchived(member.id, !member.archived_at),
                member.archived_at ? '다시 활성화했습니다.' : '비활성 처리했습니다.',
              )
            }
          >
            {member.archived_at ? '다시 활성화' : '비활성 처리'}
          </button>
          <button
            type="button"
            className="btn btn--sm btn--danger"
            disabled={busy}
            onClick={async () => {
              setError(null)
              try {
                if (await memberHasAttendance(member.id)) {
                  setError('참여 기록이 있어 삭제할 수 없습니다. 과거 기록 보존을 위해 “비활성 처리”를 사용하세요.')
                  return
                }
              } catch (e) {
                setError(errorMessage(e))
                return
              }
              if (!window.confirm(`${member.nickname} 님을 완전히 삭제할까요? 되돌릴 수 없습니다.`)) return
              await act(() => deleteMember(member.id), '삭제했습니다.')
              navigate('/members')
            }}
          >
            삭제 (기록 없는 경우만)
          </button>
          <a className="btn btn--sm btn--ghost" href={href(`/members/${member.id}`)}>
            개인 참여율 보기
          </a>
        </div>
      </section>
    </div>
  )
}

function PeriodEditor({
  period,
  busy,
  act,
  canDelete,
}: {
  period: PeriodRow
  busy: boolean
  act: (fn: () => Promise<unknown>, ok: string) => Promise<void>
  canDelete: boolean
}) {
  const [joined, setJoined] = useState(toKstInputValue(new Date(period.joined_at)))
  const [left, setLeft] = useState(period.left_at ? toKstInputValue(new Date(period.left_at)) : '')
  useEffect(() => {
    setJoined(toKstInputValue(new Date(period.joined_at)))
    setLeft(period.left_at ? toKstInputValue(new Date(period.left_at)) : '')
  }, [period.joined_at, period.left_at])
  const j = fromKstInputValue(joined)
  const l = left ? fromKstInputValue(left) : null
  const invalid = !j || (left !== '' && !l) || (l && j && l <= j)
  const changed = j?.toISOString() !== new Date(period.joined_at).toISOString() || (l?.toISOString() ?? null) !== (period.left_at ? new Date(period.left_at).toISOString() : null)
  return (
    <div className="row" style={{ marginBottom: 8, alignItems: 'flex-end' }}>
      <div className="field mb-0">
        <label htmlFor={`pj-${period.id}`}>가입 (KST)</label>
        <input id={`pj-${period.id}`} className="input input--sm" type="datetime-local" value={joined} onChange={(e) => setJoined(e.target.value)} />
      </div>
      <div className="field mb-0">
        <label htmlFor={`pl-${period.id}`}>탈퇴 (비우면 재적 중)</label>
        <input id={`pl-${period.id}`} className="input input--sm" type="datetime-local" value={left} onChange={(e) => setLeft(e.target.value)} />
      </div>
      <button
        type="button"
        className="btn btn--sm"
        disabled={busy || !!invalid || !changed}
        onClick={() => void act(() => updatePeriod(period.id, j!.toISOString(), l?.toISOString() ?? null), '재적 기간을 수정했습니다.')}
      >
        저장
      </button>
      {canDelete && (
        <button
          type="button"
          className="btn btn--sm btn--ghost"
          disabled={busy}
          onClick={() => {
            if (window.confirm('이 재적 구간을 삭제할까요?')) void act(() => deletePeriod(period.id), '재적 구간을 삭제했습니다.')
          }}
        >
          구간 삭제
        </button>
      )}
      {invalid && <span className="small" style={{ color: 'var(--danger)' }}>탈퇴는 가입보다 늦어야 합니다.</span>}
    </div>
  )
}

function AddPeriod({
  memberId,
  busy,
  act,
}: {
  memberId: string
  busy: boolean
  act: (fn: () => Promise<unknown>, ok: string) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [joined, setJoined] = useState('')
  const [left, setLeft] = useState('')
  if (!open)
    return (
      <button type="button" className="btn btn--sm btn--ghost" onClick={() => setOpen(true)}>
        + 과거 재적 구간 추가
      </button>
    )
  const j = fromKstInputValue(joined)
  const l = left ? fromKstInputValue(left) : null
  return (
    <div className="row" style={{ alignItems: 'flex-end' }}>
      <div className="field mb-0">
        <label htmlFor={`ap-j-${memberId}`}>가입 (KST)</label>
        <input id={`ap-j-${memberId}`} className="input input--sm" type="datetime-local" value={joined} onChange={(e) => setJoined(e.target.value)} />
      </div>
      <div className="field mb-0">
        <label htmlFor={`ap-l-${memberId}`}>탈퇴</label>
        <input id={`ap-l-${memberId}`} className="input input--sm" type="datetime-local" value={left} onChange={(e) => setLeft(e.target.value)} />
      </div>
      <button
        type="button"
        className="btn btn--sm"
        disabled={busy || !j || (left !== '' && !l)}
        onClick={() =>
          void act(async () => {
            await addPeriod(memberId, j!.toISOString(), l?.toISOString() ?? null)
            setOpen(false)
          }, '재적 구간을 추가했습니다.')
        }
      >
        추가
      </button>
      <button type="button" className="btn btn--sm btn--ghost" onClick={() => setOpen(false)}>
        취소
      </button>
    </div>
  )
}
