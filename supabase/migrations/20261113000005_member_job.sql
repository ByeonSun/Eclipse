-- 하이 길드 | 보스 참여 관리 — 5 길드원 직업
-- 길드원 관리에서 OCR 별칭 대신 직업(소서리스·레인저·파이터·어쌔신)을 고른다.
-- 기존 별칭 테이블은 지우지 않는다(이미 있는 데이터 보존). 화면에서는 더 이상 다루지 않는다.

alter table public.members
  add column if not exists job text;

alter table public.members
  drop constraint if exists members_job_allowed;
alter table public.members
  add constraint members_job_allowed check (job is null or job in ('소서리스', '레인저', '파이터', '어쌔신'));

-- 길드원 등록 RPC: job 을 함께 받는다.
-- p_rows: [{ "nickname": "...", "joined_at": "ISO", "left_at": "ISO"|null, "job": "소서리스"|null }]
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

    insert into public.members (nickname, job)
    values (btrim(v_row ->> 'nickname'), nullif(btrim(coalesce(v_row ->> 'job', '')), ''))
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
