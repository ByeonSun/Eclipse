-- 하이 길드 | 보스 참여 관리 — 3/3 RPC (원자적 쓰기, 참여율 계산)

-- ---------------------------------------------------------------------------
-- 길드원 일괄 등록 (한 명 등록도 이 함수를 쓴다)
-- p_rows: [{ "nickname": "...", "joined_at": "ISO", "left_at": "ISO"|null, "aliases": ["..."] }]
-- 하나라도 실패하면 전체가 롤백된다.
-- ---------------------------------------------------------------------------
create or replace function public.create_members(p_rows jsonb)
returns setof uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row jsonb;
  v_id uuid;
  v_alias text;
  v_joined timestamptz;
  v_left timestamptz;
begin
  if not public.is_admin() then
    raise exception '관리자 권한이 필요합니다.' using errcode = '42501';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception '등록할 길드원이 없습니다.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) > 500 then
    raise exception '한 번에 최대 500명까지 등록할 수 있습니다.' using errcode = '22023';
  end if;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_joined := (v_row ->> 'joined_at')::timestamptz;
    v_left := nullif(v_row ->> 'left_at', '')::timestamptz;
    if v_joined is null then
      raise exception '"%"의 가입일이 없습니다.', v_row ->> 'nickname' using errcode = '22023';
    end if;

    insert into public.members (nickname, archived_at)
    values (btrim(v_row ->> 'nickname'), case when v_left is not null and (v_row ->> 'archive')::boolean then now() end)
    returning id into v_id;

    insert into public.membership_periods (member_id, joined_at, left_at)
    values (v_id, v_joined, v_left);

    if jsonb_typeof(v_row -> 'aliases') = 'array' then
      for v_alias in select btrim(x) from jsonb_array_elements_text(v_row -> 'aliases') x where btrim(x) <> '' loop
        insert into public.member_aliases (member_id, alias) values (v_id, v_alias);
      end loop;
    end if;

    return next v_id;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 닉네임 변경 (선택: 이전 닉네임을 OCR 별칭으로 보존)
-- 과거 참여 기록은 member_id 로 연결되어 있고 당시 닉네임은 nickname_snapshot 에 남는다.
-- ---------------------------------------------------------------------------
create or replace function public.rename_member(p_member_id uuid, p_nickname text, p_keep_old_as_alias boolean default false)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_old text;
begin
  if not public.is_admin() then
    raise exception '관리자 권한이 필요합니다.' using errcode = '42501';
  end if;
  select nickname into v_old from public.members where id = p_member_id for update;
  if not found then
    raise exception '길드원을 찾을 수 없습니다.' using errcode = 'P0002';
  end if;
  if public.normalize_name(v_old) = public.normalize_name(p_nickname) then
    update public.members set nickname = btrim(p_nickname) where id = p_member_id;
    return;
  end if;
  update public.members set nickname = btrim(p_nickname) where id = p_member_id;
  if p_keep_old_as_alias then
    insert into public.member_aliases (member_id, alias) values (p_member_id, v_old)
    on conflict (normalized_alias) do nothing;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 보스 회차 저장 (생성/수정 공용, 단일 트랜잭션)
--  * p_expected_updated_at 이 null 이면 "생성". 같은 id 가 이미 있으면 아무것도 바꾸지 않고
--    기존 회차를 돌려준다 → 더블 클릭/네트워크 재시도에도 중복이 생기지 않는다.
--  * p_expected_updated_at 이 있으면 "수정". 다른 사람이 먼저 고쳤으면 충돌로 거부한다.
--  * 작성자/수정자는 auth.uid() 로만 기록한다.
-- p_attendees: [{ "member_id": "uuid", "match_method": "exact|alias|manual" }]
-- ---------------------------------------------------------------------------
create or replace function public.save_boss_run(
  p_id uuid,
  p_boss_level integer,
  p_occurred_at timestamptz,
  p_note text,
  p_attendees jsonb,
  p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_count integer;
  v_distinct integer;
  v_missing integer;
  v_conflicts text;
  v_existing public.boss_runs%rowtype;
  v_inserted uuid;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  perform public.assert_admin();

  if p_id is null then
    raise exception '회차 ID가 없습니다.' using errcode = '22023';
  end if;
  if p_boss_level is null or p_boss_level not in (40, 45, 50, 55, 60, 65, 70, 75, 80, 85) then
    raise exception '허용되지 않은 보스 레벨입니다: %', p_boss_level using errcode = '22023';
  end if;
  if p_occurred_at is null then
    raise exception '처치 시각을 입력하세요.' using errcode = '22023';
  end if;
  if p_occurred_at > now() + interval '10 minutes' then
    raise exception '처치 시각이 미래입니다.' using errcode = '22023';
  end if;
  if p_attendees is null or jsonb_typeof(p_attendees) <> 'array' or jsonb_array_length(p_attendees) = 0 then
    raise exception '참여자를 한 명 이상 선택하세요.' using errcode = '22023';
  end if;

  create temporary table if not exists pg_temp.hai_attendees (member_id uuid, match_method text) on commit drop;
  delete from pg_temp.hai_attendees;
  insert into pg_temp.hai_attendees (member_id, match_method)
  select (x ->> 'member_id')::uuid, coalesce(x ->> 'match_method', 'manual')
    from jsonb_array_elements(p_attendees) x;

  select count(*), count(distinct member_id) into v_count, v_distinct from pg_temp.hai_attendees;
  if v_count <> v_distinct then
    raise exception '같은 길드원이 한 회차에 중복으로 포함되어 있습니다.' using errcode = '23505';
  end if;
  if exists (select 1 from pg_temp.hai_attendees where member_id is null or match_method not in ('exact', 'alias', 'manual')) then
    raise exception '참여자 정보가 올바르지 않습니다.' using errcode = '22023';
  end if;
  select count(*) into v_missing
    from pg_temp.hai_attendees t left join public.members m on m.id = t.member_id
   where m.id is null;
  if v_missing > 0 then
    raise exception '등록되지 않은 길드원이 포함되어 있습니다.' using errcode = '23503';
  end if;

  select string_agg(m.nickname, ', ' order by m.nickname) into v_conflicts
    from pg_temp.hai_attendees t join public.members m on m.id = t.member_id
   where not public.member_active_at(t.member_id, p_occurred_at);
  if v_conflicts is not null then
    raise exception '처치 시각에 재적 상태가 아닌 길드원이 있습니다: %', v_conflicts
      using errcode = '23514', hint = 'membership_conflict', detail = v_conflicts;
  end if;

  if p_expected_updated_at is null then
    -- 생성 (멱등)
    insert into public.boss_runs (id, boss_level, occurred_at, note, created_by, updated_by)
    values (p_id, p_boss_level, p_occurred_at, v_note, v_uid, v_uid)
    on conflict (id) do nothing
    returning id into v_inserted;

    if v_inserted is null then
      select * into v_existing from public.boss_runs where id = p_id;
      return jsonb_build_object('id', v_existing.id, 'created', false, 'updated_at', v_existing.updated_at);
    end if;

    insert into public.attendances (boss_run_id, member_id, nickname_snapshot, match_method)
    select p_id, t.member_id, m.nickname, t.match_method
      from pg_temp.hai_attendees t join public.members m on m.id = t.member_id;

    select * into v_existing from public.boss_runs where id = p_id;
    return jsonb_build_object('id', p_id, 'created', true, 'updated_at', v_existing.updated_at);
  end if;

  -- 수정
  select * into v_existing from public.boss_runs where id = p_id for update;
  if not found then
    raise exception '회차를 찾을 수 없습니다.' using errcode = 'P0002';
  end if;
  if v_existing.cancelled_at is not null then
    raise exception '취소된 회차는 복구한 뒤 수정할 수 있습니다.' using errcode = '55000';
  end if;
  if date_trunc('milliseconds', v_existing.updated_at) <> date_trunc('milliseconds', p_expected_updated_at) then
    raise exception '다른 곳에서 먼저 수정된 회차입니다. 새로고침 후 다시 시도하세요.'
      using errcode = '40001', hint = 'stale_update';
  end if;

  update public.boss_runs
     set boss_level = p_boss_level, occurred_at = p_occurred_at, note = v_note,
         updated_by = v_uid, updated_at = now()
   where id = p_id;

  delete from public.attendances a
   where a.boss_run_id = p_id
     and not exists (select 1 from pg_temp.hai_attendees t where t.member_id = a.member_id);

  insert into public.attendances (boss_run_id, member_id, nickname_snapshot, match_method)
  select p_id, t.member_id, m.nickname, t.match_method
    from pg_temp.hai_attendees t join public.members m on m.id = t.member_id
  on conflict (boss_run_id, member_id) do nothing;

  select * into v_existing from public.boss_runs where id = p_id;
  return jsonb_build_object('id', p_id, 'created', false, 'updated_at', v_existing.updated_at);
end;
$$;

-- ---------------------------------------------------------------------------
-- 회차 취소 / 복구 (이력은 보존, 통계에서만 제외)
-- ---------------------------------------------------------------------------
create or replace function public.set_boss_run_cancelled(p_id uuid, p_cancelled boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.boss_runs%rowtype;
begin
  perform public.assert_admin();
  update public.boss_runs
     set cancelled_at = case when p_cancelled then coalesce(cancelled_at, now()) else null end,
         updated_by = (select auth.uid()),
         updated_at = now()
   where id = p_id
  returning * into v_row;
  if not found then
    raise exception '회차를 찾을 수 없습니다.' using errcode = 'P0002';
  end if;
  return jsonb_build_object('id', v_row.id, 'cancelled_at', v_row.cancelled_at, 'updated_at', v_row.updated_at);
end;
$$;

-- ---------------------------------------------------------------------------
-- 참여율 원천 데이터 (참여율 숫자는 저장하지 않고 매번 계산)
-- 길드원 × 레벨별로
--   eligible = 기간 안의 유효(취소 아님) 회차 중, 그 시각에 길드원이 재적 중이던 회차 수
--   attended = 그중 실제 참여한 회차 수
-- 재가입자는 재적 구간들이 서로 겹치지 않으므로 자연스럽게 합산된다.
-- p_from 포함, p_to 제외. null 이면 제한 없음.
-- SECURITY INVOKER 라서 RLS 가 그대로 적용된다.
-- ---------------------------------------------------------------------------
create or replace function public.attendance_stats(
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_member_id uuid default null
)
returns table (member_id uuid, boss_level smallint, eligible integer, attended integer)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception '관리자 권한이 필요합니다.' using errcode = '42501';
  end if;
  return query
  with runs as (
    select r.id, r.boss_level, r.occurred_at
      from public.boss_runs r
     where r.cancelled_at is null
       and (p_from is null or r.occurred_at >= p_from)
       and (p_to is null or r.occurred_at < p_to)
  ), eligible_runs as (
    select mp.member_id, r.id as run_id, r.boss_level
      from runs r
      join public.membership_periods mp
        on mp.joined_at <= r.occurred_at
       and (mp.left_at is null or r.occurred_at < mp.left_at)
     where p_member_id is null or mp.member_id = p_member_id
  )
  select e.member_id, e.boss_level, count(*)::integer, count(a.member_id)::integer
    from eligible_runs e
    left join public.attendances a on a.boss_run_id = e.run_id and a.member_id = e.member_id
   group by e.member_id, e.boss_level
   order by e.member_id, e.boss_level;
end;
$$;

-- ---------------------------------------------------------------------------
-- 길드원 한 명의 참여 가능 회차 목록 (참여/미참여)
-- 가입 전·탈퇴 후 회차는 목록에 나오지 않는다(미참여로 표시하지 않음).
-- ---------------------------------------------------------------------------
create or replace function public.member_runs(
  p_member_id uuid,
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns table (
  boss_run_id uuid,
  boss_level smallint,
  occurred_at timestamptz,
  attended boolean,
  nickname_snapshot text,
  match_method text
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception '관리자 권한이 필요합니다.' using errcode = '42501';
  end if;
  return query
  select r.id, r.boss_level, r.occurred_at, a.member_id is not null, a.nickname_snapshot, a.match_method
    from public.boss_runs r
    join public.membership_periods mp
      on mp.member_id = p_member_id
     and mp.joined_at <= r.occurred_at
     and (mp.left_at is null or r.occurred_at < mp.left_at)
    left join public.attendances a on a.boss_run_id = r.id and a.member_id = p_member_id
   where r.cancelled_at is null
     and (p_from is null or r.occurred_at >= p_from)
     and (p_to is null or r.occurred_at < p_to)
   order by r.occurred_at desc, r.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 대시보드: 기간 내 유효 회차 수와 참여 인원 합 (레벨별)
-- ---------------------------------------------------------------------------
create or replace function public.run_level_counts(
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns table (boss_level smallint, runs integer, attendances integer)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception '관리자 권한이 필요합니다.' using errcode = '42501';
  end if;
  return query
  select r.boss_level, count(distinct r.id)::integer, count(a.member_id)::integer
    from public.boss_runs r
    left join public.attendances a on a.boss_run_id = r.id
   where r.cancelled_at is null
     and (p_from is null or r.occurred_at >= p_from)
     and (p_to is null or r.occurred_at < p_to)
   group by r.boss_level;
end;
$$;

-- ---------------------------------------------------------------------------
-- 실행 권한: 익명 금지, 인증 사용자만 (각 함수 안에서 관리자 재확인)
-- ---------------------------------------------------------------------------
revoke execute on function public.create_members(jsonb) from public, anon;
revoke execute on function public.rename_member(uuid, text, boolean) from public, anon;
revoke execute on function public.save_boss_run(uuid, integer, timestamptz, text, jsonb, timestamptz) from public, anon;
revoke execute on function public.set_boss_run_cancelled(uuid, boolean) from public, anon;
revoke execute on function public.attendance_stats(timestamptz, timestamptz, uuid) from public, anon;
revoke execute on function public.member_runs(uuid, timestamptz, timestamptz) from public, anon;
revoke execute on function public.run_level_counts(timestamptz, timestamptz) from public, anon;
grant execute on function public.run_level_counts(timestamptz, timestamptz) to authenticated;

grant execute on function public.create_members(jsonb) to authenticated;
grant execute on function public.rename_member(uuid, text, boolean) to authenticated;
grant execute on function public.save_boss_run(uuid, integer, timestamptz, text, jsonb, timestamptz) to authenticated;
grant execute on function public.set_boss_run_cancelled(uuid, boolean) to authenticated;
grant execute on function public.attendance_stats(timestamptz, timestamptz, uuid) to authenticated;
grant execute on function public.member_runs(uuid, timestamptz, timestamptz) to authenticated;
