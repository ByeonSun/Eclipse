-- 하이 길드 | 보스 참여 관리 — 4 save_boss_run 수정
-- Supabase 는 API 요청에서 WHERE 없는 DELETE/UPDATE 를 막는다(pg_safeupdate).
-- 임시 표를 비울 때 DELETE 대신 TRUNCATE 를 쓴다. (함수 권한은 create or replace 로 유지된다)

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
  truncate pg_temp.hai_attendees;
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
