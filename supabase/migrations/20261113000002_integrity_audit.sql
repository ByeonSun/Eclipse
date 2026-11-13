-- 하이 길드 | 보스 참여 관리 — 2/3 무결성 트리거, 감사 로그, 권한(RLS)

-- ---------------------------------------------------------------------------
-- 관리자 판별
-- auth.uid() 만 사용한다. 클라이언트가 보낸 ID나 user_metadata 는 신뢰하지 않는다.
-- ---------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.admin_users au where au.user_id = (select auth.uid())
  )
$$;

create or replace function public.assert_admin()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception '관리자 권한이 필요합니다.' using errcode = '42501';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- updated_at 자동 갱신
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger members_touch before update on public.members
  for each row execute function public.touch_updated_at();
create trigger membership_periods_touch before update on public.membership_periods
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 닉네임 ↔ 별칭 정규화 키 충돌 검사
--  * 별칭은 어떤 길드원의 닉네임과도 같을 수 없다.
--  * 닉네임은 다른 길드원의 별칭과 같을 수 없다.
--  * 닉네임을 자신의 별칭으로 바꾸면 그 별칭은 자동으로 정리된다.
-- ---------------------------------------------------------------------------
create or replace function public.check_alias_key()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text := public.normalize_name(new.alias);
  v_owner text;
begin
  perform pg_advisory_xact_lock(hashtext('hai-name:' || v_key));
  select m.nickname into v_owner from public.members m where m.normalized_nickname = v_key;
  if found then
    raise exception '별칭 "%"은(는) 길드원 "%"의 닉네임과 같습니다.', new.alias, v_owner
      using errcode = '23505', hint = 'alias_conflicts_nickname';
  end if;
  return new;
end;
$$;

create trigger member_aliases_check_key
  before insert or update of alias on public.member_aliases
  for each row execute function public.check_alias_key();

create or replace function public.check_nickname_key()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text := public.normalize_name(new.nickname);
  v_owner text;
begin
  perform pg_advisory_xact_lock(hashtext('hai-name:' || v_key));
  select m.nickname into v_owner
    from public.member_aliases a join public.members m on m.id = a.member_id
   where a.normalized_alias = v_key and a.member_id <> new.id;
  if found then
    raise exception '닉네임 "%"은(는) 길드원 "%"의 별칭으로 등록되어 있습니다.', new.nickname, v_owner
      using errcode = '23505', hint = 'nickname_conflicts_alias';
  end if;
  delete from public.member_aliases a where a.member_id = new.id and a.normalized_alias = v_key;
  return new;
end;
$$;

create trigger members_check_key
  before insert or update of nickname on public.members
  for each row execute function public.check_nickname_key();

-- ---------------------------------------------------------------------------
-- 참여 기록 ↔ 재적 기간 정합성
-- 참여자는 회차 시각에 재적 중이어야 한다. 어떤 경로로 쓰든 DB가 막는다.
-- ---------------------------------------------------------------------------
create or replace function public.member_active_at(p_member_id uuid, p_at timestamptz)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.membership_periods mp
     where mp.member_id = p_member_id
       and mp.joined_at <= p_at
       and (mp.left_at is null or p_at < mp.left_at)
  )
$$;

create or replace function public.check_attendance_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_at timestamptz;
begin
  select r.occurred_at into v_at from public.boss_runs r where r.id = new.boss_run_id;
  if not public.member_active_at(new.member_id, v_at) then
    raise exception '"%"은(는) 회차 시각(%)에 길드 재적 상태가 아닙니다.',
      new.nickname_snapshot, to_char(v_at at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI')
      using errcode = '23514', hint = 'membership_conflict';
  end if;
  return new;
end;
$$;

create constraint trigger attendances_membership
  after insert or update on public.attendances
  deferrable initially deferred
  for each row execute function public.check_attendance_membership();

create or replace function public.check_run_time_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_names text;
begin
  select string_agg(a.nickname_snapshot, ', ' order by a.nickname_snapshot) into v_names
    from public.attendances a
   where a.boss_run_id = new.id
     and not public.member_active_at(a.member_id, new.occurred_at);
  if v_names is not null then
    raise exception '변경한 처치 시각에 재적 상태가 아닌 참여자가 있습니다: %', v_names
      using errcode = '23514', hint = 'membership_conflict';
  end if;
  return new;
end;
$$;

create constraint trigger boss_runs_time_membership
  after update of occurred_at on public.boss_runs
  deferrable initially deferred
  for each row execute function public.check_run_time_membership();

-- 재적 기간을 고치거나 지울 때, 이미 저장된 참여 기록이 재적 밖으로 밀려나면 막는다.
create or replace function public.check_period_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member uuid := old.member_id;
  v_list text;
begin
  select string_agg(to_char(r.occurred_at at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') || ' ' || r.boss_level || '레벨', ', '
                    order by r.occurred_at)
    into v_list
    from public.attendances a
    join public.boss_runs r on r.id = a.boss_run_id
   where a.member_id = v_member
     and not public.member_active_at(v_member, r.occurred_at);
  if v_list is not null then
    raise exception '이 변경을 적용하면 재적 기간 밖의 참여 기록이 생깁니다: %', v_list
      using errcode = '23514', hint = 'membership_conflict';
  end if;
  return null;
end;
$$;

create constraint trigger membership_periods_keep_attendance
  after update or delete on public.membership_periods
  deferrable initially deferred
  for each row execute function public.check_period_change();

-- ---------------------------------------------------------------------------
-- 감사 로그 트리거 (브라우저는 audit_logs 에 직접 쓸 수 없다)
-- ---------------------------------------------------------------------------
create or replace function public.write_audit_log()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before jsonb;
  v_after jsonb;
  v_row jsonb;
begin
  if tg_op in ('UPDATE', 'DELETE') then v_before := to_jsonb(old); end if;
  if tg_op in ('INSERT', 'UPDATE') then v_after := to_jsonb(new); end if;
  if tg_op = 'UPDATE' and v_before = v_after then
    return null;
  end if;
  v_row := coalesce(v_after, v_before);
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, before_data, after_data)
  values (
    (select auth.uid()),
    lower(tg_op),
    tg_table_name,
    coalesce(v_row ->> 'id', v_row ->> 'boss_run_id', v_row ->> 'user_id')::uuid,
    v_before,
    v_after
  );
  return null;
end;
$$;

create trigger audit_members after insert or update or delete on public.members
  for each row execute function public.write_audit_log();
create trigger audit_member_aliases after insert or update or delete on public.member_aliases
  for each row execute function public.write_audit_log();
create trigger audit_membership_periods after insert or update or delete on public.membership_periods
  for each row execute function public.write_audit_log();
create trigger audit_boss_runs after insert or update or delete on public.boss_runs
  for each row execute function public.write_audit_log();
create trigger audit_attendances after insert or update or delete on public.attendances
  for each row execute function public.write_audit_log();
create trigger audit_admin_users after insert or update or delete on public.admin_users
  for each row execute function public.write_audit_log();

-- ---------------------------------------------------------------------------
-- RLS
-- 공개 키(anon/publishable)가 노출된다는 전제로, 테이블 권한과 RLS 를 함께 건다.
-- ---------------------------------------------------------------------------
alter table public.admin_users        enable row level security;
alter table public.members            enable row level security;
alter table public.member_aliases     enable row level security;
alter table public.membership_periods enable row level security;
alter table public.boss_runs          enable row level security;
alter table public.attendances        enable row level security;
alter table public.audit_logs         enable row level security;

-- 익명 사용자는 어떤 테이블도 다루지 못한다.
revoke all on public.admin_users, public.members, public.member_aliases, public.membership_periods,
              public.boss_runs, public.attendances, public.audit_logs
  from anon, public;

-- 인증 사용자도 기본은 전부 회수한 뒤 필요한 것만 부여한다.
revoke all on public.admin_users, public.members, public.member_aliases, public.membership_periods,
              public.boss_runs, public.attendances, public.audit_logs
  from authenticated;

-- admin_users: 자신의 행만 읽기. 추가·삭제는 SQL 편집기/service_role 등 신뢰된 운영 경로만 가능.
grant select on public.admin_users to authenticated;
create policy admin_users_select_self on public.admin_users
  for select to authenticated using (user_id = (select auth.uid()));

-- 명단: 관리자만 읽기·쓰기
grant select, insert, update, delete on public.members, public.member_aliases, public.membership_periods
  to authenticated;

create policy members_admin_all on public.members
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy member_aliases_admin_all on public.member_aliases
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy membership_periods_admin_all on public.membership_periods
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- 회차·참여: 관리자 읽기만. 쓰기는 원자적 RPC(save_boss_run 등)로만 한다.
grant select on public.boss_runs, public.attendances to authenticated;
create policy boss_runs_admin_select on public.boss_runs
  for select to authenticated using ((select public.is_admin()));
create policy attendances_admin_select on public.attendances
  for select to authenticated using ((select public.is_admin()));

-- 감사 로그: 관리자 읽기만. 작성·수정·삭제 권한 없음.
grant select on public.audit_logs to authenticated;
create policy audit_logs_admin_select on public.audit_logs
  for select to authenticated using ((select public.is_admin()));

-- 내부 함수 실행 권한 정리
revoke execute on function public.is_admin(), public.assert_admin(), public.member_active_at(uuid, timestamptz),
  public.touch_updated_at(), public.check_alias_key(), public.check_nickname_key(),
  public.check_attendance_membership(), public.check_run_time_membership(), public.check_period_change(),
  public.write_audit_log()
  from public, anon, authenticated;
grant execute on function public.is_admin() to authenticated;
