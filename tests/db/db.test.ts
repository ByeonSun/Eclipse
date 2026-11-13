// 실제 PostgreSQL(embedded-postgres)에 마이그레이션을 적용하고 권한·RPC·참여율을 검증한다.
import { readFileSync, readdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import EmbeddedPostgres from 'embedded-postgres'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { kstDateToUtc, kstDayRange } from '../../src/lib/time'
import { formatRate } from '../../src/lib/stats'

const root = resolve(__dirname, '../..')
const dataDir = join(root, 'node_modules', '.tmp', 'hai-pg')
const port = 55432 + Math.floor(Math.random() * 500)
let server: EmbeddedPostgres
let pool: pg.Pool

const ADMIN = randomUUID()
const OUTSIDER = randomUUID()

type Who = { role: 'anon' } | { role: 'authenticated'; uid: string } | { role: 'owner' }

async function as<T>(who: Who, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect()
  try {
    await c.query('begin')
    if (who.role !== 'owner') {
      await c.query(`set local role ${who.role}`)
      if (who.role === 'authenticated') {
        await c.query(`select set_config('request.jwt.claim.sub', $1, true)`, [who.uid])
      }
    }
    const out = await fn(c)
    await c.query('commit')
    return out
  } catch (e) {
    await c.query('rollback').catch(() => {})
    throw e
  } finally {
    c.release()
  }
}

const admin: Who = { role: 'authenticated', uid: ADMIN }
const outsider: Who = { role: 'authenticated', uid: OUTSIDER }
const anon: Who = { role: 'anon' }
const owner: Who = { role: 'owner' }

async function createMember(nickname: string, joined: string, left: string | null = null, aliases: string[] = []) {
  const r = await as(admin, (c) =>
    c.query('select * from public.create_members($1::jsonb) as id', [
      JSON.stringify([{ nickname, joined_at: joined, left_at: left, aliases }]),
    ]),
  )
  return r.rows[0].id as string
}

async function saveRun(opts: {
  id?: string
  level: number
  at: string
  members: string[]
  expected?: string | null
  note?: string | null
}) {
  const id = opts.id ?? randomUUID()
  const res = await as(admin, (c) =>
    c.query('select public.save_boss_run($1, $2, $3, $4, $5::jsonb, $6) as r', [
      id,
      opts.level,
      opts.at,
      opts.note ?? null,
      JSON.stringify(opts.members.map((m) => ({ member_id: m, match_method: 'exact' }))),
      opts.expected ?? null,
    ]),
  )
  return { id, result: res.rows[0].r as { id: string; created: boolean; updated_at: string } }
}

async function stats(member: string, from: string | null = null, to: string | null = null) {
  const r = await as(admin, (c) =>
    c.query('select boss_level, eligible, attended from public.attendance_stats($1, $2, $3) order by boss_level', [
      from,
      to,
      member,
    ]),
  )
  return r.rows as { boss_level: number; eligible: number; attended: number }[]
}

beforeAll(async () => {
  rmSync(dataDir, { recursive: true, force: true })
  server = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'postgres',
    password: 'local-test-only',
    port,
    persistent: false,
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
    onLog: () => {},
    onError: () => {},
  })
  await server.initialise()
  await server.start()
  await server.createDatabase('hai')
  pool = new pg.Pool({ host: 'localhost', port, user: 'postgres', password: 'local-test-only', database: 'hai', max: 6 })

  await pool.query(readFileSync(join(root, 'tests/db/supabase-stub.sql'), 'utf8'))
  const migDir = join(root, 'supabase/migrations')
  for (const f of readdirSync(migDir).sort()) {
    await pool.query(readFileSync(join(migDir, f), 'utf8'))
  }
  await pool.query(`insert into auth.users (id, email) values ($1, 'admin@example.test'), ($2, 'user@example.test')`, [
    ADMIN,
    OUTSIDER,
  ])
  await pool.query('insert into public.admin_users (user_id) values ($1)', [ADMIN])
}, 120_000)

afterAll(async () => {
  await pool?.end()
  await server?.stop()
})

describe('권한과 RLS', () => {
  it('익명 사용자는 테이블과 RPC에 접근할 수 없다', async () => {
    await createMember('익명테스트', '2026-01-01T00:00:00+09:00')
    for (const sql of [
      'select * from public.members',
      'select * from public.boss_runs',
      'select * from public.attendances',
      'select * from public.audit_logs',
      'select * from public.admin_users',
      'select * from public.attendance_stats()',
    ]) {
      await expect(as(anon, (c) => c.query(sql))).rejects.toThrow(/permission denied/)
    }
    await expect(
      as(anon, (c) => c.query(`select public.save_boss_run(gen_random_uuid(), 50, now(), null, '[]'::jsonb)`)),
    ).rejects.toThrow(/permission denied/)
  })

  it('관리자가 아닌 인증 사용자는 데이터를 읽거나 쓸 수 없다', async () => {
    const rows = await as(outsider, (c) => c.query('select * from public.members'))
    expect(rows.rowCount).toBe(0)
    await expect(
      as(outsider, (c) => c.query(`insert into public.members (nickname) values ('침입자')`)),
    ).rejects.toThrow(/row-level security/)
    await expect(as(outsider, (c) => c.query('select * from public.attendance_stats()'))).rejects.toThrow(
      /관리자 권한/,
    )
    await expect(
      as(outsider, (c) =>
        c.query(`select public.save_boss_run(gen_random_uuid(), 50, now(), null, '[{"member_id":"${randomUUID()}"}]')`),
      ),
    ).rejects.toThrow(/관리자 권한/)
    await expect(
      as(outsider, (c) => c.query(`select * from public.create_members('[{"nickname":"x","joined_at":"2026-01-01"}]')`)),
    ).rejects.toThrow(/관리자 권한/)
    const runs = await as(outsider, (c) => c.query('select * from public.boss_runs'))
    expect(runs.rowCount).toBe(0)
  })

  it('공개 경로로 관리자 승격을 할 수 없다', async () => {
    await expect(
      as(outsider, (c) => c.query('insert into public.admin_users (user_id) values ($1)', [OUTSIDER])),
    ).rejects.toThrow(/permission denied/)
    // 사용자 메타데이터를 바꿔도 관리자 판정에 영향이 없다.
    await pool.query(`update auth.users set raw_user_meta_data = '{"role":"admin","is_admin":true}' where id = $1`, [
      OUTSIDER,
    ])
    const r = await as(outsider, (c) => c.query('select public.is_admin() as ok'))
    expect(r.rows[0].ok).toBe(false)
    const me = await as(outsider, (c) => c.query('select * from public.admin_users'))
    expect(me.rowCount).toBe(0)
    const a = await as(admin, (c) => c.query('select * from public.admin_users'))
    expect(a.rowCount).toBe(1)
    await expect(as(admin, (c) => c.query('delete from public.admin_users'))).rejects.toThrow(/permission denied/)
  })

  it('브라우저 경로로 회차·참여·감사 로그를 직접 쓸 수 없다', async () => {
    await expect(
      as(admin, (c) =>
        c.query(`insert into public.boss_runs (boss_level, occurred_at, created_by, updated_by) values (50, now(), $1, $1)`, [
          ADMIN,
        ]),
      ),
    ).rejects.toThrow(/permission denied/)
    await expect(
      as(admin, (c) => c.query(`insert into public.audit_logs (action, entity_type) values ('x', 'y')`)),
    ).rejects.toThrow(/permission denied/)
    await expect(as(admin, (c) => c.query('delete from public.audit_logs'))).rejects.toThrow(/permission denied/)
    const logs = await as(admin, (c) => c.query(`select count(*)::int as n from public.audit_logs where actor_id = $1`, [ADMIN]))
    expect(logs.rows[0].n).toBeGreaterThan(0)
  })
})

describe('명단과 별칭', () => {
  it('정규화 키가 같은 닉네임은 중복 등록할 수 없다', async () => {
    await createMember('Moon Light', '2026-01-01T00:00:00+09:00')
    await expect(createMember('  moon   light ', '2026-01-01T00:00:00+09:00')).rejects.toThrow(/duplicate key/)
  })

  it('별칭은 다른 길드원 닉네임과 충돌할 수 없고, 닉네임도 다른 사람 별칭과 충돌할 수 없다', async () => {
    const a = await createMember('별빛하나', '2026-01-01T00:00:00+09:00')
    await createMember('별빛둘', '2026-01-01T00:00:00+09:00', null, ['별빛2'])
    await expect(
      as(admin, (c) => c.query(`insert into public.member_aliases (member_id, alias) values ($1, '별빛둘')`, [a])),
    ).rejects.toThrow(/닉네임과 같습니다/)
    await expect(as(admin, (c) => c.query(`update public.members set nickname = '별빛2' where id = $1`, [a]))).rejects.toThrow(
      /별칭으로 등록/,
    )
    await expect(
      as(admin, (c) => c.query(`insert into public.member_aliases (member_id, alias) values ($1, '별빛2')`, [a])),
    ).rejects.toThrow(/duplicate key/)
  })

  it('재적 구간 중첩은 DB가 막는다', async () => {
    const m = await createMember('겹침검사', '2026-01-01T00:00:00+09:00', '2026-03-01T00:00:00+09:00')
    await expect(
      as(admin, (c) =>
        c.query(`insert into public.membership_periods (member_id, joined_at) values ($1, '2026-02-01T00:00:00+09:00')`, [m]),
      ),
    ).rejects.toThrow(/membership_periods_no_overlap/)
    // 탈퇴 시각과 같은 시각 재가입은 허용 ([joined, left) 구간)
    await as(admin, (c) =>
      c.query(`insert into public.membership_periods (member_id, joined_at) values ($1, '2026-03-01T00:00:00+09:00')`, [m]),
    )
    await expect(
      as(admin, (c) =>
        c.query(
          `insert into public.membership_periods (member_id, joined_at, left_at) values ($1, '2025-01-01T00:00:00+09:00', '2024-01-01T00:00:00+09:00')`,
          [m],
        ),
      ),
    ).rejects.toThrow(/membership_periods_order/)
  })
})

describe('직업', () => {
  it('허용된 직업만 저장되고, 등록 RPC 로 함께 저장할 수 있다', async () => {
    const r = await as(admin, (c) =>
      c.query(`select * from public.create_members($1::jsonb) as id`, [
        JSON.stringify([{ nickname: '직업소서', joined_at: '2026-01-01T00:00:00+09:00', job: '소서리스' }]),
      ]),
    )
    const id = r.rows[0].id
    const row = await as(admin, (c) => c.query('select job from public.members where id = $1', [id]))
    expect(row.rows[0].job).toBe('소서리스')
    await as(admin, (c) => c.query(`update public.members set job = '어쌔신' where id = $1`, [id]))
    await expect(
      as(admin, (c) => c.query(`update public.members set job = '마법사' where id = $1`, [id])),
    ).rejects.toThrow(/members_job_allowed/)
    await as(admin, (c) => c.query(`update public.members set job = null where id = $1`, [id]))
  })
})

describe('보스 회차 저장', () => {
  it('같은 날 같은 레벨 두 회차를 저장할 수 있다', async () => {
    const m = await createMember('두회차', '2026-01-01T00:00:00+09:00')
    const r1 = await saveRun({ level: 60, at: '2026-05-05T10:00:00+09:00', members: [m] })
    const r2 = await saveRun({ level: 60, at: '2026-05-05T10:00:00+09:00', members: [m] })
    expect(r1.id).not.toBe(r2.id)
    const s = await stats(m)
    expect(s).toEqual([{ boss_level: 60, eligible: 2, attended: 2 }])
  })

  it('더블 클릭·재시도(같은 회차 ID)는 회차를 하나만 만든다', async () => {
    const m = await createMember('재시도', '2026-01-01T00:00:00+09:00')
    const id = randomUUID()
    const calls = await Promise.all([
      saveRun({ id, level: 70, at: '2026-05-06T21:00:00+09:00', members: [m] }),
      saveRun({ id, level: 70, at: '2026-05-06T21:00:00+09:00', members: [m] }),
      saveRun({ id, level: 70, at: '2026-05-06T21:00:00+09:00', members: [m] }),
    ])
    expect(calls.filter((c) => c.result.created).length).toBe(1)
    const n = await as(admin, (c) => c.query('select count(*)::int as n from public.boss_runs where id = $1', [id]))
    expect(n.rows[0].n).toBe(1)
    const a = await as(admin, (c) => c.query('select count(*)::int as n from public.attendances where boss_run_id = $1', [id]))
    expect(a.rows[0].n).toBe(1)
  })

  it('저장 중 오류가 나면 회차와 참여자가 부분 저장되지 않는다', async () => {
    const ok = await createMember('정상참여', '2026-01-01T00:00:00+09:00')
    const late = await createMember('늦은가입', '2026-06-01T00:00:00+09:00')
    const id = randomUUID()
    await expect(saveRun({ id, level: 50, at: '2026-05-10T20:00:00+09:00', members: [ok, late] })).rejects.toThrow(
      /재적 상태가 아닌 길드원.*늦은가입/,
    )
    const id2 = randomUUID()
    await expect(saveRun({ id: id2, level: 50, at: '2026-05-10T20:00:00+09:00', members: [ok, randomUUID()] })).rejects.toThrow(
      /등록되지 않은 길드원/,
    )
    await expect(saveRun({ level: 50, at: '2026-05-10T20:00:00+09:00', members: [ok, ok] })).rejects.toThrow(/중복/)
    await expect(saveRun({ level: 51, at: '2026-05-10T20:00:00+09:00', members: [ok] })).rejects.toThrow(/허용되지 않은/)
    const n = await as(admin, (c) =>
      c.query('select count(*)::int as n from public.boss_runs where id = any($1::uuid[])', [[id, id2]]),
    )
    expect(n.rows[0].n).toBe(0)
    const a = await as(admin, (c) => c.query('select count(*)::int as n from public.attendances where member_id = $1', [ok]))
    expect(a.rows[0].n).toBe(0)
  })

  it('회차 수정은 참여자를 교체하고, 오래된 버전으로 덮어쓰기를 막는다', async () => {
    const a = await createMember('수정A', '2026-01-01T00:00:00+09:00')
    const b = await createMember('수정B', '2026-01-01T00:00:00+09:00')
    const { id, result } = await saveRun({ level: 75, at: '2026-05-11T20:00:00+09:00', members: [a] })
    const upd = await saveRun({ id, level: 80, at: '2026-05-11T20:30:00+09:00', members: [b], expected: result.updated_at })
    expect(upd.result.created).toBe(false)
    const rows = await as(admin, (c) =>
      c.query('select member_id from public.attendances where boss_run_id = $1', [id]),
    )
    expect(rows.rows.map((r) => r.member_id)).toEqual([b])
    await expect(
      saveRun({ id, level: 85, at: '2026-05-11T20:30:00+09:00', members: [a], expected: result.updated_at }),
    ).rejects.toThrow(/먼저 수정된/)
  })

  it('과거 기록이 있는 길드원은 물리 삭제할 수 없다', async () => {
    const m = await createMember('삭제불가', '2026-01-01T00:00:00+09:00')
    await saveRun({ level: 40, at: '2026-05-12T20:00:00+09:00', members: [m] })
    await expect(as(admin, (c) => c.query('delete from public.members where id = $1', [m]))).rejects.toThrow(
      /foreign key/,
    )
    const fresh = await createMember('삭제가능', '2026-01-01T00:00:00+09:00')
    await as(admin, (c) => c.query('delete from public.members where id = $1', [fresh]))
  })

  it('참여 기록을 재적 밖으로 밀어내는 재적 기간 수정은 거부된다', async () => {
    const m = await createMember('기간보호', '2026-01-01T00:00:00+09:00')
    await saveRun({ level: 45, at: '2026-05-13T20:00:00+09:00', members: [m] })
    await expect(
      as(admin, (c) =>
        c.query(`update public.membership_periods set joined_at = '2026-06-01T00:00:00+09:00' where member_id = $1`, [m]),
      ),
    ).rejects.toThrow(/재적 기간 밖의 참여 기록/)
  })
})

describe('참여율 계산', () => {
  it('3/4 = 75.0%, 분모 0 = —', async () => {
    const m = await createMember('칠십오', '2026-01-01T00:00:00+09:00')
    const other = await createMember('다른사람', '2026-01-01T00:00:00+09:00')
    for (let i = 0; i < 4; i++) {
      await saveRun({ level: 50, at: `2026-07-0${i + 1}T20:00:00+09:00`, members: i < 3 ? [m] : [other] })
    }
    const s = await stats(m, '2026-07-01T00:00:00+09:00', '2026-08-01T00:00:00+09:00')
    expect(s).toEqual([{ boss_level: 50, eligible: 4, attended: 3 }])
    expect(formatRate(3, 4)).toBe('75.0%')
    expect(formatRate(0, 0)).toBe('—')
  })

  it('가입 전·탈퇴 후 회차는 분모에서 빠지고, 재가입 구간은 합산되며, 취소 회차는 제외된다', async () => {
    const someone = await createMember('항상있음', '2025-01-01T00:00:00+09:00')
    const m = await createMember('재가입자', '2026-08-03T00:00:00+09:00', '2026-08-05T00:00:00+09:00')
    await as(admin, (c) =>
      c.query(`insert into public.membership_periods (member_id, joined_at) values ($1, '2026-08-07T00:00:00+09:00')`, [m]),
    )
    // 8/1, 8/2 가입 전 / 8/3, 8/4 재적 / 8/5, 8/6 탈퇴 중 / 8/7, 8/8 재가입 / 8/9 취소
    const runs: Record<string, string> = {}
    for (const d of ['01', '02', '03', '04', '05', '06', '07', '08', '09']) {
      const at = `2026-08-${d}T20:00:00+09:00`
      const inMember = ['03', '07', '08', '09'].includes(d)
      const { id } = await saveRun({ level: 55, at, members: inMember ? [someone, m] : [someone] })
      runs[d] = id
    }
    await as(admin, (c) => c.query('select public.set_boss_run_cancelled($1, true)', [runs['09']]))
    const s = await stats(m, '2026-08-01T00:00:00+09:00', '2026-09-01T00:00:00+09:00')
    // 재적 중 회차: 03, 04, 07, 08 → 4회, 참여 03, 07, 08 → 3회
    expect(s).toEqual([{ boss_level: 55, eligible: 4, attended: 3 }])

    const list = await as(admin, (c) =>
      c.query(`select boss_run_id, attended from public.member_runs($1, '2026-08-01T00:00:00+09:00', '2026-09-01T00:00:00+09:00')`, [m]),
    )
    expect(list.rowCount).toBe(4)
    expect(list.rows.filter((r) => !r.attended).map((r) => r.boss_run_id)).toEqual([runs['04']])

    // 취소 복구 후에는 다시 포함
    await as(admin, (c) => c.query('select public.set_boss_run_cancelled($1, false)', [runs['09']]))
    const s2 = await stats(m, '2026-08-01T00:00:00+09:00', '2026-09-01T00:00:00+09:00')
    expect(s2).toEqual([{ boss_level: 55, eligible: 5, attended: 4 }])
  })

  it('한국 날짜 자정 경계로 정확히 나눈다', async () => {
    const m = await createMember('자정경계', '2026-01-01T00:00:00+09:00')
    await saveRun({ level: 65, at: '2026-09-09T23:59:59+09:00', members: [m] })
    await saveRun({ level: 65, at: '2026-09-10T00:00:00+09:00', members: [m] })
    const day = kstDayRange('2026-09-10')
    expect(day.from.toISOString()).toBe('2026-09-09T15:00:00.000Z')
    const s = await stats(m, day.from.toISOString(), day.to.toISOString())
    expect(s).toEqual([{ boss_level: 65, eligible: 1, attended: 1 }])
    const prev = await stats(m, kstDateToUtc('2026-09-09').toISOString(), day.from.toISOString())
    expect(prev).toEqual([{ boss_level: 65, eligible: 1, attended: 1 }])
  })

  it('닉네임을 바꿔도 과거 기록과 당시 닉네임이 유지된다', async () => {
    const m = await createMember('옛닉네임', '2026-01-01T00:00:00+09:00')
    const { id } = await saveRun({ level: 85, at: '2026-10-01T20:00:00+09:00', members: [m] })
    await as(admin, (c) => c.query(`select public.rename_member($1, '새닉네임', true)`, [m]))
    const row = await as(admin, (c) =>
      c.query(
        `select a.nickname_snapshot, m.nickname from public.attendances a join public.members m on m.id = a.member_id where a.boss_run_id = $1`,
        [id],
      ),
    )
    expect(row.rows[0]).toEqual({ nickname_snapshot: '옛닉네임', nickname: '새닉네임' })
    const alias = await as(admin, (c) => c.query('select alias from public.member_aliases where member_id = $1', [m]))
    expect(alias.rows.map((r) => r.alias)).toEqual(['옛닉네임'])
    expect(await stats(m, '2026-10-01T00:00:00+09:00', '2026-10-02T00:00:00+09:00')).toEqual([
      { boss_level: 85, eligible: 1, attended: 1 },
    ])
  })

  it('대시보드 레벨별 집계는 취소 회차를 빼고 기간을 지킨다', async () => {
    const r = await as(admin, (c) =>
      c.query(
        `select boss_level, runs, attendances from public.run_level_counts('2026-08-01T00:00:00+09:00', '2026-09-01T00:00:00+09:00')`,
      ),
    )
    // 8월: 55레벨 9회 중 9일 회차는 앞 테스트에서 복구됨 → 9회
    expect(r.rows).toEqual([{ boss_level: 55, runs: 9, attendances: 13 }])
    await expect(as(outsider, (c) => c.query('select * from public.run_level_counts()'))).rejects.toThrow(/관리자 권한/)
  })

  it('소유자 경로에서도 audit 로그가 남는다', async () => {
    const r = await as(owner, (c) =>
      c.query(`select count(*)::int as n from public.audit_logs where entity_type = 'boss_runs' and action = 'insert'`),
    )
    expect(r.rows[0].n).toBeGreaterThan(5)
  })
})
