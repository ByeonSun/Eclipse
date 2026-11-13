// Supabase 는 API(PostgREST) 요청에서 WHERE 없는 DELETE/UPDATE 를 거부한다(pg_safeupdate).
// 로컬 PostgreSQL 에는 이 확장이 없으므로, 마이그레이션 SQL 을 정적으로 검사한다.
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const dir = resolve(__dirname, '../../supabase/migrations')
const files = readdirSync(dir).sort()

/** 마지막 마이그레이션이 정의한 함수 본문만 남긴다 (나중 파일이 앞 파일의 함수를 대체) */
function latestFunctionBodies(): Map<string, string> {
  const out = new Map<string, string>()
  for (const f of files) {
    const sql = readFileSync(join(dir, f), 'utf8')
    for (const m of sql.matchAll(/create or replace function (public\.[a-z_]+)\([\s\S]*?\$\$([\s\S]*?)\$\$;/gi)) {
      out.set(m[1], m[2])
    }
  }
  return out
}

function unguarded(body: string): string[] {
  const flat = body.replace(/--.*$/gm, '').replace(/\s+/g, ' ')
  return [...flat.matchAll(/\b(?:delete from|update)\s[^;]*/gi)]
    .map((m) => m[0].trim())
    .filter((s) => !/\bdo update\b/i.test(s) && !/ where /i.test(s))
}

describe('Supabase pg_safeupdate 호환', () => {
  it('함수 안의 DELETE/UPDATE 에는 모두 WHERE 가 있다', () => {
    const bad: string[] = []
    for (const [name, body] of latestFunctionBodies()) {
      for (const s of unguarded(body)) bad.push(`${name}: ${s}`)
    }
    expect(bad).toEqual([])
  })

  it('검사기가 실제로 위반을 잡는다', () => {
    expect(unguarded('begin delete from pg_temp.x; update t set a = 1; delete from t where id = 1; end')).toEqual([
      'delete from pg_temp.x',
      'update t set a = 1',
    ])
  })
})
