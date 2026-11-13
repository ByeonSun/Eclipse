import type { Job } from './constants'
import { db } from './supabase'
import type { StatRow } from './stats'

export interface AliasRow {
  id: string
  alias: string
}
export interface PeriodRow {
  id: string
  joined_at: string
  left_at: string | null
}
export interface Member {
  id: string
  nickname: string
  job: Job | null
  archived_at: string | null
  created_at: string
  updated_at: string
  member_aliases: AliasRow[]
  membership_periods: PeriodRow[]
}

export interface RunSummary {
  id: string
  boss_level: number
  occurred_at: string
  note: string | null
  cancelled_at: string | null
  created_at: string
  updated_at: string
  attendances: { count: number }[]
}

export interface RunAttendance {
  member_id: string
  nickname_snapshot: string
  match_method: 'exact' | 'alias' | 'manual'
  members: { nickname: string } | null
}

export interface RunDetail {
  id: string
  boss_level: number
  occurred_at: string
  note: string | null
  cancelled_at: string | null
  created_at: string
  updated_at: string
  created_by: string
  updated_by: string
  attendances: RunAttendance[]
}

export interface MemberRunRow {
  boss_run_id: string
  boss_level: number
  occurred_at: string
  attended: boolean
  nickname_snapshot: string | null
  match_method: string | null
}

function check<T>(r: { data: T | null; error: unknown }): T {
  if (r.error) throw r.error
  return r.data as T
}

// ---------------------------------------------------------------------------
// 권한
// ---------------------------------------------------------------------------
export async function isAdmin(): Promise<boolean> {
  return check(await db().rpc('is_admin')) === true
}

// ---------------------------------------------------------------------------
// 명단
// ---------------------------------------------------------------------------
export async function fetchRoster(): Promise<Member[]> {
  const rows = await allPages<Member>((a, b) =>
    db()
      .from('members')
      .select(
        'id,nickname,job,archived_at,created_at,updated_at,member_aliases(id,alias),membership_periods(id,joined_at,left_at)',
      )
      .order('nickname')
      .order('id')
      .range(a, b),
  )
  for (const m of rows) {
    m.membership_periods.sort((a, b) => a.joined_at.localeCompare(b.joined_at))
    m.member_aliases.sort((a, b) => a.alias.localeCompare(b.alias, 'ko'))
  }
  return rows
}

export interface NewMemberInput {
  nickname: string
  joined_at: string
  left_at?: string | null
  job?: Job | null
}

export async function setJob(id: string, job: Job | null) {
  check(await db().from('members').update({ job }).eq('id', id))
}

export async function createMembers(rows: NewMemberInput[]): Promise<string[]> {
  return check(await db().rpc('create_members', { p_rows: rows })) as string[]
}

export async function renameMember(id: string, nickname: string, keepOldAsAlias: boolean) {
  check(await db().rpc('rename_member', { p_member_id: id, p_nickname: nickname, p_keep_old_as_alias: keepOldAsAlias }))
}

export async function addAlias(memberId: string, alias: string) {
  check(await db().from('member_aliases').insert({ member_id: memberId, alias: alias.trim() }))
}

export async function deleteAlias(id: string) {
  check(await db().from('member_aliases').delete().eq('id', id))
}

export async function addPeriod(memberId: string, joinedAt: string, leftAt: string | null) {
  check(await db().from('membership_periods').insert({ member_id: memberId, joined_at: joinedAt, left_at: leftAt }))
}

export async function updatePeriod(id: string, joinedAt: string, leftAt: string | null) {
  check(await db().from('membership_periods').update({ joined_at: joinedAt, left_at: leftAt }).eq('id', id))
}

export async function deletePeriod(id: string) {
  check(await db().from('membership_periods').delete().eq('id', id))
}

export async function setArchived(id: string, archived: boolean) {
  check(
    await db()
      .from('members')
      .update({ archived_at: archived ? new Date().toISOString() : null })
      .eq('id', id),
  )
}

export async function deleteMember(id: string) {
  check(await db().from('members').delete().eq('id', id))
}

export async function memberHasAttendance(id: string): Promise<boolean> {
  const r = await db().from('attendances').select('boss_run_id', { count: 'exact', head: true }).eq('member_id', id)
  if (r.error) throw r.error
  return (r.count ?? 0) > 0
}

// ---------------------------------------------------------------------------
// 보스 회차
// ---------------------------------------------------------------------------
export interface SaveRunInput {
  id: string
  bossLevel: number
  occurredAt: string
  note: string | null
  attendees: { member_id: string; match_method: 'exact' | 'alias' | 'manual' }[]
  /** 수정 시 기존 updated_at (낙관적 잠금) */
  expectedUpdatedAt?: string | null
}

export async function saveBossRun(input: SaveRunInput): Promise<{ id: string; created: boolean; updated_at: string }> {
  return check(
    await db().rpc('save_boss_run', {
      p_id: input.id,
      p_boss_level: input.bossLevel,
      p_occurred_at: input.occurredAt,
      p_note: input.note,
      p_attendees: input.attendees,
      p_expected_updated_at: input.expectedUpdatedAt ?? null,
    }),
  )
}

export async function setRunCancelled(id: string, cancelled: boolean) {
  return check(await db().rpc('set_boss_run_cancelled', { p_id: id, p_cancelled: cancelled }))
}

export async function fetchRun(id: string): Promise<RunDetail | null> {
  const r = await db()
    .from('boss_runs')
    .select(
      'id,boss_level,occurred_at,note,cancelled_at,created_at,updated_at,created_by,updated_by,attendances(member_id,nickname_snapshot,match_method,members(nickname))',
    )
    .eq('id', id)
    .maybeSingle()
  // members 는 FK(다대일)라 실제로는 단일 객체가 온다
  const row = check(r) as unknown as RunDetail | null
  row?.attendances.sort((a, b) => a.nickname_snapshot.localeCompare(b.nickname_snapshot, 'ko'))
  return row
}

export interface RunQuery {
  from: Date | null
  to: Date | null
  level?: number | null
  memberId?: string | null
  includeCancelled?: boolean
  limit?: number
}

export async function listRuns(q: RunQuery): Promise<RunSummary[]> {
  let ids: string[] | null = null
  if (q.memberId) {
    const a = check(await db().from('attendances').select('boss_run_id').eq('member_id', q.memberId)) as {
      boss_run_id: string
    }[]
    ids = a.map((x) => x.boss_run_id)
    if (!ids.length) return []
  }
  let query = db()
    .from('boss_runs')
    .select('id,boss_level,occurred_at,note,cancelled_at,created_at,updated_at,attendances(count)')
    .order('occurred_at', { ascending: false })
    .limit(q.limit ?? 500)
  if (q.from) query = query.gte('occurred_at', q.from.toISOString())
  if (q.to) query = query.lt('occurred_at', q.to.toISOString())
  if (q.level) query = query.eq('boss_level', q.level)
  if (!q.includeCancelled) query = query.is('cancelled_at', null)
  if (ids) query = query.in('id', ids)
  return check(await query) as RunSummary[]
}

const PAGE = 1000

/** PostgREST 최대 행 수(기본 1000) 제한을 넘어도 전부 받도록 나눠서 조회 */
async function allPages<T>(fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>) {
  const out: T[] = []
  for (let offset = 0; ; offset += PAGE) {
    const rows = check(await fetchPage(offset, offset + PAGE - 1)) as T[]
    out.push(...rows)
    if (rows.length < PAGE) return out
  }
}

export async function fetchStats(from: Date | null, to: Date | null, memberId: string | null = null): Promise<StatRow[]> {
  const args = { p_from: from?.toISOString() ?? null, p_to: to?.toISOString() ?? null, p_member_id: memberId }
  return allPages<StatRow>((a, b) => db().rpc('attendance_stats', args).range(a, b))
}

export async function fetchLevelCounts(
  from: Date | null,
  to: Date | null,
): Promise<{ boss_level: number; runs: number; attendances: number }[]> {
  return check(
    await db().rpc('run_level_counts', { p_from: from?.toISOString() ?? null, p_to: to?.toISOString() ?? null }),
  ) as { boss_level: number; runs: number; attendances: number }[]
}

export async function fetchMemberRuns(memberId: string, from: Date | null, to: Date | null): Promise<MemberRunRow[]> {
  const args = { p_member_id: memberId, p_from: from?.toISOString() ?? null, p_to: to?.toISOString() ?? null }
  return allPages<MemberRunRow>((a, b) => db().rpc('member_runs', args).range(a, b))
}

// ---------------------------------------------------------------------------
// 명단 도우미
// ---------------------------------------------------------------------------
export function activeAt(m: Pick<Member, 'membership_periods'>, at: Date): boolean {
  const t = at.getTime()
  return m.membership_periods.some(
    (p) => new Date(p.joined_at).getTime() <= t && (!p.left_at || t < new Date(p.left_at).getTime()),
  )
}

export function memberStatus(m: Member, now = new Date()): { label: string; tone: 'active' | 'left' | 'pending' | 'archived' } {
  if (m.archived_at) return { label: '비활성', tone: 'archived' }
  if (activeAt(m, now)) return { label: '재적', tone: 'active' }
  const future = m.membership_periods.some((p) => new Date(p.joined_at) > now)
  if (future) return { label: '가입 예정', tone: 'pending' }
  return { label: '탈퇴', tone: 'left' }
}
