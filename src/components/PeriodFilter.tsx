import { useState } from 'react'
import { kstDateString, resolvePeriod, type Period, type PeriodKind } from '../lib/time'

const KINDS: { kind: PeriodKind; label: string }[] = [
  { kind: 'week', label: '이번 주' },
  { kind: 'month', label: '이번 달' },
  { kind: 'all', label: '전체 기간' },
  { kind: 'custom', label: '직접 지정' },
]

export function PeriodFilter({
  value,
  onChange,
  allowAll = true,
}: {
  value: Period
  onChange: (p: Period) => void
  allowAll?: boolean
}) {
  const today = kstDateString(new Date())
  const [start, setStart] = useState(value.start ?? today.slice(0, 8) + '01')
  const [end, setEnd] = useState(value.end ?? today)
  const resolved = resolvePeriod(value)

  return (
    <div className="row" role="group" aria-label="조회 기간">
      <div className="segmented">
        {KINDS.filter((k) => allowAll || k.kind !== 'all').map((k) => (
          <button
            key={k.kind}
            type="button"
            aria-pressed={value.kind === k.kind}
            onClick={() => onChange(k.kind === 'custom' ? { kind: 'custom', start, end } : { kind: k.kind })}
          >
            {k.label}
          </button>
        ))}
      </div>
      {value.kind === 'custom' && (
        <>
          <label className="sr-only" htmlFor="period-start">
            시작일
          </label>
          <input
            id="period-start"
            className="input input--sm"
            style={{ width: 150 }}
            type="date"
            value={start}
            max={end || undefined}
            onChange={(e) => {
              setStart(e.target.value)
              onChange({ kind: 'custom', start: e.target.value, end })
            }}
          />
          <span className="muted" aria-hidden="true">
            ~
          </span>
          <label className="sr-only" htmlFor="period-end">
            종료일
          </label>
          <input
            id="period-end"
            className="input input--sm"
            style={{ width: 150 }}
            type="date"
            value={end}
            min={start || undefined}
            onChange={(e) => {
              setEnd(e.target.value)
              onChange({ kind: 'custom', start, end: e.target.value })
            }}
          />
        </>
      )}
      <span className="small muted">{resolved.valid ? `${resolved.label} · 한국 시각` : resolved.error}</span>
    </div>
  )
}
