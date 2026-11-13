// RFC 4180 CSV 파서/작성기 (외부 의존성 없음)

/** 수식 삽입(CSV injection) 방지: = + - @ 탭 CR 로 시작하면 앞에 ' 를 붙인다. */
export function escapeFormula(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
}

function quote(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

export function toCsv(rows: (string | number | null | undefined)[][]): string {
  return rows
    .map((r) =>
      r
        .map((v) => {
          if (v === null || v === undefined) return ''
          if (typeof v === 'number') return String(v)
          return quote(escapeFormula(v))
        })
        .join(','),
    )
    .join('\r\n')
}

/** UTF-8 BOM 을 붙여 엑셀에서 한글이 깨지지 않게 한다. */
export function csvBlob(rows: (string | number | null | undefined)[][]): Blob {
  return new Blob(['﻿' + toCsv(rows) + '\r\n'], { type: 'text/csv;charset=utf-8' })
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '')
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"'
          i++
        } else inQuotes = false
      } else field += ch
      continue
    }
    if (ch === '"' && field === '') inQuotes = true
    else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += ch
  }
  if (field !== '' || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

/** 내보낸 CSV 를 다시 가져올 때 수식 방지용 ' 접두어를 되돌린다. */
export function unescapeFormula(value: string): string {
  return /^'[=+\-@\t\r]/.test(value) ? value.slice(1) : value
}
