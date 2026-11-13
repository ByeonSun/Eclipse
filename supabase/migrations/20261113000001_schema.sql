-- 하이 길드 | 보스 참여 관리 — 1/3 스키마
-- 모든 시각은 timestamptz 로 저장하고, 화면 표시는 Asia/Seoul 로 변환한다.

create schema if not exists extensions;
create extension if not exists btree_gist with schema extensions;

-- ---------------------------------------------------------------------------
-- 닉네임 정규화 키
--  * 유니코드 NFC 정규화
--  * 앞뒤 공백 제거, 연속 공백/줄바꿈은 공백 하나로 축약 (내부 공백 자체는 유지)
--  * 라틴 문자는 소문자로 비교
--  * 숫자·특수문자는 삭제하지 않는다
-- 프런트엔드 src/lib/normalize.ts 의 normalizeName() 과 동일한 규칙이다.
-- ---------------------------------------------------------------------------
create or replace function public.normalize_name(p text)
returns text
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select lower(btrim(regexp_replace(normalize(p, NFC), '[[:space:]]+', ' ', 'g')))
$$;

-- ---------------------------------------------------------------------------
-- 관리자
-- ---------------------------------------------------------------------------
create table public.admin_users (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 길드원 (닉네임과 ID 분리)
-- ---------------------------------------------------------------------------
create table public.members (
  id                  uuid primary key default gen_random_uuid(),
  nickname            text not null,
  normalized_nickname text generated always as (public.normalize_name(nickname)) stored,
  archived_at         timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint members_nickname_not_blank check (public.normalize_name(nickname) <> ''),
  constraint members_nickname_length check (char_length(nickname) <= 40),
  constraint members_normalized_nickname_key unique (normalized_nickname)
);

create table public.member_aliases (
  id               uuid primary key default gen_random_uuid(),
  member_id        uuid not null references public.members (id) on delete cascade,
  alias            text not null,
  normalized_alias text generated always as (public.normalize_name(alias)) stored,
  created_at       timestamptz not null default now(),
  constraint member_aliases_alias_not_blank check (public.normalize_name(alias) <> ''),
  constraint member_aliases_alias_length check (char_length(alias) <= 40),
  constraint member_aliases_normalized_alias_key unique (normalized_alias)
);
create index member_aliases_member_id_idx on public.member_aliases (member_id);

-- 재적 구간: [joined_at, left_at)  — 가입 시각 포함, 탈퇴 시각 제외
create table public.membership_periods (
  id         uuid primary key default gen_random_uuid(),
  member_id  uuid not null references public.members (id) on delete cascade,
  joined_at  timestamptz not null,
  left_at    timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint membership_periods_order check (left_at is null or left_at > joined_at),
  constraint membership_periods_no_overlap exclude using gist (
    member_id with =,
    tstzrange(joined_at, left_at, '[)') with &&
  )
);
create index membership_periods_member_idx on public.membership_periods (member_id, joined_at);

-- ---------------------------------------------------------------------------
-- 보스 회차
-- id 는 클라이언트가 만든다. 재시도해도 같은 id 라서 중복 생성되지 않는다.
-- 날짜+레벨 UNIQUE 는 의도적으로 두지 않는다 (같은 날 같은 레벨 여러 회차 허용).
-- ---------------------------------------------------------------------------
create table public.boss_runs (
  id           uuid primary key default gen_random_uuid(),
  boss_level   smallint not null,
  occurred_at  timestamptz not null,
  note         text,
  created_by   uuid not null references auth.users (id),
  updated_by   uuid not null references auth.users (id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  cancelled_at timestamptz,
  constraint boss_runs_level_allowed check (boss_level in (40, 45, 50, 55, 60, 65, 70, 75, 80, 85)),
  constraint boss_runs_note_length check (note is null or char_length(note) <= 500)
);
create index boss_runs_occurred_idx on public.boss_runs (occurred_at desc) where cancelled_at is null;
create index boss_runs_level_occurred_idx on public.boss_runs (boss_level, occurred_at) where cancelled_at is null;
create index boss_runs_occurred_all_idx on public.boss_runs (occurred_at desc);

create table public.attendances (
  boss_run_id       uuid not null references public.boss_runs (id) on delete cascade,
  member_id         uuid not null references public.members (id) on delete restrict,
  nickname_snapshot text not null,
  match_method      text not null,
  constraint attendances_pkey primary key (boss_run_id, member_id),
  constraint attendances_match_method check (match_method in ('exact', 'alias', 'manual'))
);
create index attendances_member_idx on public.attendances (member_id, boss_run_id);

-- ---------------------------------------------------------------------------
-- 감사 로그 (트리거만 작성)
-- ---------------------------------------------------------------------------
create table public.audit_logs (
  id          uuid primary key default gen_random_uuid(),
  actor_id    uuid,
  action      text not null,
  entity_type text not null,
  entity_id   uuid,
  before_data jsonb,
  after_data  jsonb,
  created_at  timestamptz not null default now()
);
create index audit_logs_entity_idx on public.audit_logs (entity_type, entity_id, created_at desc);
create index audit_logs_created_idx on public.audit_logs (created_at desc);
