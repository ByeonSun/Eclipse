import { useId, useMemo, useRef, useState } from 'react'
import { useRoster } from '../data/RosterProvider'
import { memberStatus, type Member } from '../lib/api'
import { normalizeName } from '../lib/normalize'
import { searchMembers } from '../lib/matching'
import { MemberStatusBadge } from './ui'

/**
 * 닉네임·별칭 부분 검색 콤보박스 (WAI-ARIA combobox 패턴).
 * 후보만 보여주고, 사용자가 클릭·Enter 로 고르기 전에는 아무도 선택하지 않는다.
 */
export function MemberSearch({
  onSelect,
  placeholder = '길드원 닉네임을 검색하세요',
  label = '길드원 검색',
  exclude,
  clearOnSelect = true,
  autoFocus,
}: {
  onSelect: (m: Member) => void
  placeholder?: string
  label?: string
  exclude?: Set<string>
  clearOnSelect?: boolean
  autoFocus?: boolean
}) {
  const { members, loading } = useRoster()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const id = useId()
  const listId = `${id}-list`

  const results = useMemo(() => {
    const pool = exclude ? members.filter((m) => !exclude.has(m.id)) : members
    const withAliases = pool.map((m) => ({ ...m, aliases: m.member_aliases.map((a) => a.alias) }))
    return searchMembers(withAliases, q, 12)
  }, [members, q, exclude])

  const pick = (m: Member) => {
    onSelect(m)
    setOpen(false)
    if (clearOnSelect) setQ('')
    else setQ(m.nickname)
  }

  const aliasHit = (m: Member) => {
    const key = normalizeName(q)
    if (normalizeName(m.nickname).includes(key)) return null
    return m.member_aliases.find((a) => normalizeName(a.alias).includes(key))?.alias ?? null
  }

  const showList = open && q.trim() !== ''

  return (
    <div className="search">
      <label htmlFor={`${id}-input`} className="sr-only">
        {label}
      </label>
      <span className="search__icon" aria-hidden="true">
        ⌕
      </span>
      <input
        ref={inputRef}
        id={`${id}-input`}
        className="input search__input"
        type="search"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && results[active] ? `${id}-opt-${active}` : undefined}
        autoComplete="off"
        placeholder={placeholder}
        value={q}
        autoFocus={autoFocus}
        onChange={(e) => {
          setQ(e.target.value)
          setOpen(true)
          setActive(0)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setOpen(true)
            setActive((a) => Math.min(a + 1, Math.max(results.length - 1, 0)))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActive((a) => Math.max(a - 1, 0))
          } else if (e.key === 'Enter') {
            if (showList && results[active]) {
              e.preventDefault()
              pick(results[active])
            }
          } else if (e.key === 'Escape') {
            setOpen(false)
          }
        }}
      />
      {q && (
        <button
          type="button"
          className="btn btn--ghost btn--icon search__clear"
          aria-label="검색어 지우기"
          onClick={() => {
            setQ('')
            inputRef.current?.focus()
          }}
        >
          ✕
        </button>
      )}
      {showList && (
        <ul className="search__list" id={listId} role="listbox" aria-label="검색 결과">
          {loading && !members.length ? (
            <li className="search__empty">명단 불러오는 중…</li>
          ) : results.length === 0 ? (
            <li className="search__empty" role="option" aria-selected="false" aria-disabled="true">
              일치하는 길드원이 없습니다
            </li>
          ) : (
            results.map((m, i) => {
              const st = memberStatus(m)
              const alias = aliasHit(m)
              return (
                <li
                  key={m.id}
                  id={`${id}-opt-${i}`}
                  role="option"
                  aria-selected={i === active}
                  className="search__option"
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(m)}
                >
                  <span>
                    <span className="strong">{m.nickname}</span>
                    {alias && <small> · 별칭 “{alias}”</small>}
                  </span>
                  <MemberStatusBadge {...st} />
                </li>
              )
            })
          )}
        </ul>
      )}
    </div>
  )
}
