# 하이 | 보스 참여 관리

하이 길드의 보스 참여 기록을 남기고 참여율을 계산하는 관리자 전용 웹앱입니다.

- 배포 주소: https://byeonsun.github.io/Eclipse/
- 프런트엔드: React 19 + TypeScript + Vite 8 (해시 라우팅, GitHub Pages 정적 배포)
- DB·인증: Supabase PostgreSQL + Supabase Auth (이메일·비밀번호, 공개 회원가입 없음)
- OCR: Tesseract.js 7 (한국어+영어, 브라우저 Web Worker). 이미지는 서버로 보내지 않습니다.
- 기본 시간대: Asia/Seoul. DB에는 모두 `timestamptz` 로 저장하고 화면에서 KST로 표시합니다.

## 핵심 흐름

관리자 로그인 → 「참여 기록 추가」 → 캡처 붙여넣기(Win+Shift+S → Ctrl+V)·드래그·파일 선택(여러 장 가능)
→ 필요하면 이미지 위를 드래그해 OCR 영역 지정 → 명단·별칭과 자동 대조 → 결과 확인·수정
→ 보스 레벨(40~85, 5단위)과 실제 처치 시각 선택 → 저장 → 회차 상세 화면, 참여율·이력에 즉시 반영.

저장 버튼을 누르기 전에는 DB에 아무것도 기록되지 않습니다. OCR이 실패해도 길드원 검색으로 직접 추가해 저장할 수 있습니다.

## 화면

| 경로 | 화면 |
| --- | --- |
| `#/` | 대시보드: 현재 길드원 수, 기간별 기록 수, 레벨별 기록 수, 최근 기록, 닉네임 검색 |
| `#/record/new` | 참여 기록 작성 (이미지 입력, 영역 선택, OCR, 매칭 확인, 레벨·시각, 저장) |
| `#/runs/<id>` | 회차 상세 (당시 닉네임·현재 닉네임, 수정, 취소·복구) |
| `#/sheet` | 참여율 시트 (길드원 × 레벨, 기간 필터, 정렬, 셀 클릭 시 계산 내역, CSV 내보내기) |
| `#/history` | 날짜별 이력 (KST 날짜 범위, 레벨·길드원 필터, 취소 회차 포함 여부) |
| `#/members` | 길드원 관리 (한 명 등록, 줄바꿈 일괄 등록, CSV 가져오기·내보내기, 별칭, 가입·탈퇴, 비활성) |
| `#/members/<id>` | 개인 참여율 (기간별 전체·레벨별 참여율, 참여 가능 회차 목록) |
| `#/settings` | 비밀번호 변경(현재 비밀번호 재확인), 로그아웃 |

## 참여율 정의

참여율은 DB에 저장하지 않고 원본 기록(`boss_runs`, `attendances`, `membership_periods`)에서 매번 계산합니다
(`public.attendance_stats` RPC).

- 분자: 조회 기간 중, 해당 길드원이 참여한 해당 레벨의 **유효 회차** 수
- 분모: 조회 기간 중, 해당 길드원의 **재적 기간**에 발생한 해당 레벨의 유효 회차 수
- 참여율 = 분자 ÷ 분모 × 100, 소수점 한 자리. 분모가 0이면 `—`
- 재적 구간은 `[가입 시각, 탈퇴 시각)` — 가입 시각 포함, 탈퇴 시각 제외. 재가입자는 구간을 모두 합산
- 취소된 회차는 분자·분모 모두에서 제외(기록은 보존)
- 전체 참여율 = 전체 참여 횟수 ÷ 전체 참여 가능 횟수 (레벨별 퍼센트의 평균이 아님)
- 화면에는 “등록된 보스 회차 기준 참여율”로 표시합니다. 기록되지 않은 실제 보스 출현은 알 수 없습니다.

예: 재적 중 50레벨 회차 4회 중 3회 참여 → `75.0% · 3/4`. 50레벨 기록이 없으면 `—`.
가입 전 2회 + 가입 후 2회가 있으면 분모는 2입니다.

## 로컬 실행

```bash
npm ci
cp .env.example .env.local   # 값 채우기 (Windows PowerShell: Copy-Item .env.example .env.local)
npm run dev                  # http://localhost:5173
```

Supabase 설정이 없으면 연결 안내 화면만 표시되고 예시 데이터는 보여주지 않습니다.

### 환경변수

| 이름 | 설명 |
| --- | --- |
| `VITE_SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | 공개용 키(`sb_publishable_…` 또는 legacy `anon` 키). `VITE_SUPABASE_ANON_KEY` 이름도 인식 |

프런트엔드에는 공개용 값만 넣습니다. `service_role`/`sb_secret_` 키, DB 비밀번호, 관리자 비밀번호는 저장소·빌드 산출물·로그에 넣지 않습니다.
앱은 비밀 키가 설정되면 사용을 거부하고, CI는 `scripts/check-bundle.mjs` 로 빌드 결과에 비밀 키가 없는지 검사합니다.
공개용 키는 노출된다는 전제로 RLS·권한·RPC 안의 관리자 검사로 데이터를 보호합니다.

## Supabase 설정

1. Supabase에서 새 프로젝트를 만듭니다(리전은 가까운 곳, 예: Seoul).
2. **SQL 적용** — SQL Editor에서 아래 파일을 **순서대로** 실행합니다(또는 Supabase CLI `supabase db push`).
   1. `supabase/migrations/20261113000001_schema.sql` — 테이블, 제약, 인덱스
   2. `supabase/migrations/20261113000002_integrity_audit.sql` — 무결성 트리거, 감사 로그, RLS·권한
   3. `supabase/migrations/20261113000003_rpc.sql` — 저장/취소/통계 RPC
3. **공개 회원가입 끄기** — Authentication → Sign In / Providers → Email:
   “Allow new users to sign up” 를 끕니다. (켜져 있어도 admin_users 에 없으면 데이터 접근은 거부되지만, 끄는 것이 안전합니다.)
4. **URL 설정** — Authentication → URL Configuration
   - Site URL: `https://byeonsun.github.io/Eclipse/`
   - Redirect URLs: `https://byeonsun.github.io/Eclipse/**`, 로컬 개발 시 `http://localhost:5173/**`
5. (권장) Authentication → Providers → Email 의 “Secure password change” 를 켭니다.

### 최초 관리자 만들기

웹에는 관리자 등록 API가 없습니다. 아래 운영 절차로만 만듭니다.

1. Authentication → Users → **Add user** → 이메일·비밀번호 입력, “Auto Confirm User” 체크.
2. SQL Editor에서 실행 (이메일만 바꿔서):

```sql
insert into public.admin_users (user_id)
select id from auth.users where email = 'admin@example.com';
```

관리자 해제: `delete from public.admin_users where user_id = (select id from auth.users where email = '...');`

`admin_users` 는 브라우저(anon/authenticated)에서 쓰기 권한이 없고, `user_metadata` 는 권한 판정에 쓰지 않습니다.
화면 상단의 “admin” 은 표시용 이름일 뿐 로그인 이메일과 별개입니다.

### 로그인·비밀번호 복구

- 로그인: 이메일·비밀번호 (`signInWithPassword`)
- 비밀번호 찾기: 로그인 화면 “비밀번호를 잊으셨나요?” → 재설정 메일 → 링크(`…/Eclipse/?recovery=1&code=…`)를
  **요청한 같은 브라우저**에서 열기 → 새 비밀번호 설정. (PKCE 방식이라 다른 브라우저에서는 열리지 않습니다.)
- 로그인 상태 비밀번호 변경: 설정 화면에서 현재 비밀번호를 다시 확인한 뒤 변경
- 기본 Supabase 메일 발송은 시간당 횟수 제한이 있습니다. 운영 시 Authentication → Emails 에서 SMTP 설정을 권장합니다.

## GitHub Pages 배포

`.github/workflows/deploy.yml` 이 `main` 에 push 될 때 실행됩니다: 단위 테스트 → 실제 PostgreSQL로 DB 테스트 → 빌드 → 비밀 키 검사 → Pages 배포.

1. 저장소 Settings → Pages → Source: **GitHub Actions**
2. Settings → Secrets and variables → Actions → **Variables** 탭에 공개용 값 등록
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_PUBLISHABLE_KEY`
3. Actions 탭에서 워크플로를 다시 실행하거나 `main` 에 push

빌드는 상대 경로(`base: './'`)와 해시 라우팅을 써서 `/Eclipse/` 하위 경로와 새로고침에서도 404가 나지 않습니다.

## 데이터 백업·복구

- 앱에서: 길드원 관리 → “명단 CSV 내보내기”, 참여율 시트 → “CSV 내보내기”(UTF-8 BOM, 수식 삽입 방지 처리). 보고용이며 전체 복구용은 아닙니다.
- 전체 백업(권장): Project Settings → Database 의 연결 문자열로

```bash
pg_dump "postgresql://postgres:[DB-PASSWORD]@db.<ref>.supabase.co:5432/postgres" --schema=public --data-only --column-inserts -f hai-backup.sql
```

- 복구: 새 프로젝트에 마이그레이션 3개를 먼저 적용하고, `auth.users` 에 같은 관리자 계정을 만든 뒤
  `psql "<연결 문자열>" -f hai-backup.sql` (boss_runs 의 created_by 가 auth.users 를 참조하므로 계정 ID가 같아야 합니다.
  계정 ID가 달라지면 복구 전에 백업 파일의 UUID를 새 ID로 바꿔야 합니다.)
- 유료 플랜에서는 Supabase 일일 백업/PITR 도 사용할 수 있습니다.
- DB 비밀번호는 백업 명령에만 쓰고 저장소·스크립트에 남기지 마세요.

## 데이터 모델 요약

- `admin_users(user_id → auth.users)` — 관리자 목록. 운영 경로로만 추가/삭제
- `members(id, nickname, normalized_nickname UNIQUE, archived_at)` — 닉네임과 ID 분리. 정규화 키는 DB가 생성
- `member_aliases(member_id, alias, normalized_alias UNIQUE)` — OCR 오인식 대응. 닉네임↔별칭 키 충돌은 트리거로 차단
- `membership_periods(member_id, joined_at, left_at)` — `left_at > joined_at`, 같은 길드원 구간 중첩은 배제 제약(`btree_gist`)으로 금지
- `boss_runs(id, boss_level ∈ {40..85}, occurred_at, note, created_by, updated_by, cancelled_at)` — `id` 는 클라이언트 생성(재시도에도 동일). 날짜+레벨 UNIQUE 없음
- `attendances(boss_run_id, member_id) PK, nickname_snapshot, match_method ∈ {exact, alias, manual}` — 당시 닉네임 보존
- `audit_logs` — 모든 운영 테이블 변경을 트리거가 기록. 브라우저는 읽기만 가능(관리자)

쓰기 경로: 회차 생성·수정은 `save_boss_run` RPC 하나의 트랜잭션(참여자 포함), 작성자는 `auth.uid()` 로만 기록.
참여자가 회차 시각에 재적 중이 아니면 저장을 거부하고, 이미 저장된 참여를 재적 밖으로 밀어내는 재적 기간 수정도 거부합니다.
과거 기록이 있는 길드원은 FK(`on delete restrict`)로 물리 삭제가 막히며 “비활성 처리”를 사용합니다.

## OCR의 실제 한계

- Tesseract.js 는 범용 OCR 입니다. 게임 글꼴, 작은 글씨, 반투명 배경, 외곽선·그림자 글씨에서 오인식이 생깁니다.
  예) 합성 이미지 테스트에서 `별빛하나` → `별빚하나`, `검은달_77` → `검은달 77`.
- 그래서 정확 일치·별칭 일치만 자동 선택하고, 비슷한 글자는 “확인 필요”로 두어 관리자가 직접 연결합니다(자동 확정 없음).
  자주 틀리는 형태는 별칭으로 등록하면 다음부터 “별칭 일치”로 잡힙니다.
- 닉네임 목록 부분만 영역 지정하면 정확도가 올라갑니다. 어두운 배경은 자동으로 반전, 작은 이미지는 2배 확대합니다.
- 첫 인식 때 OCR 엔진(WASM)과 한국어·영어 데이터(수 MB)를 jsDelivr CDN에서 내려받습니다. 이후에는 브라우저 캐시를 씁니다.
  CDN 접근이 막힌 환경에서는 OCR 이 실패하며, 이때도 수동 입력으로 저장할 수 있습니다.
- 화면 공유 가져오기는 데스크톱 Chrome 등 `getDisplayMedia` 지원 브라우저의 보조 기능입니다. 사용자가 브라우저 공유 창에서
  직접 고른 화면만 볼 수 있고, 웹페이지가 프로그램 목록을 보거나 특정 창을 자동 선택하거나 공유 화면 밖을 캡처할 수는 없습니다.

## 테스트

```bash
npm test         # 단위 테스트: 정규화·매칭·유사도·CSV·KST 경계·참여율 표시·가져오기 검증·OCR 취소
npm run test:db  # 실제 PostgreSQL 18(embedded-postgres)에 마이그레이션을 적용해 RLS·RPC·참여율 검증
npm run build
```

DB 테스트는 Supabase 의 `anon`/`authenticated` 역할, `auth.uid()`, 기본 권한을 흉내 내는 `tests/db/supabase-stub.sql` 위에서
마이그레이션 원본을 그대로 실행합니다.

## 확인한 것 / 아직 확인하지 못한 것

확인함 (자동 테스트):

- 익명·비관리자 인증 사용자의 테이블/RPC 접근 거부, 공개 경로로 관리자 승격 불가, 메타데이터 변경으로 권한 획득 불가
- 관리자의 등록·조회·수정, 브라우저 경로로 회차·참여·감사 로그 직접 쓰기 불가
- 같은 날 같은 레벨 두 회차 저장, 같은 회차 ID 동시 3회 저장 시 1회만 생성
- 저장 중 오류(재적 아님·미등록·중복·잘못된 레벨) 시 회차·참여자 부분 저장 없음
- 3/4 = 75.0%, 분모 0 = `—`, 가입 전·탈퇴 후·재가입·회차 취소/복구 반영, 전체 참여율 = 횟수 합
- KST 자정 경계(23:59:59 / 00:00:00), 이번 주(월요일)·이번 달 경계
- 닉네임 변경 후 과거 기록·당시 닉네임 유지, 이전 닉네임 별칭 보존
- 정규화 키·별칭 충돌, 재적 구간 중첩, 재적 밖으로 밀리는 기간 수정 거부, 기록 있는 길드원 삭제 불가
- 여러 이미지의 같은 길드원 1회 집계, 비슷한 닉네임 자동 확정 안 함, 별칭 충돌 시 자동 매칭 차단, OCR 없이 수동 등록
- CSV 한글·쉼표·따옴표·줄바꿈 왕복, 수식 삽입 방지, UTF-8 BOM
- OCR 취소 시 즉시 종료되고 새 워커로 재시도 (모의 워커)

확인함 (브라우저 수동, 합성 이미지 — 실제 게임 캡처 아님):

- 개발 서버에서 Tesseract.js 워커·WASM·한국어/영어 데이터 로딩과 진행 상태
- 어두운 배경의 합성 길드원 목록(7명): 5명 정확 일치, 오인식 2명은 “확인 필요”로 올바른 추천 후보 제시, 잡음 줄은 미등록
- 영역 지정 인식, Supabase 미설정 시 안내 화면

아직 확인하지 못함 (Supabase 프로젝트 연결 후 확인 필요):

- 실제 Supabase 프로젝트에서의 로그인·비밀번호 재설정 메일·비밀번호 변경 흐름
- 배포 주소에서의 저장·조회 전 과정과 OCR CDN 로딩
- **실제 게임 캡처 표본으로 측정한 OCR 정확도** — 표본이 없어 측정하지 않았습니다
- 휴대폰 실기기 화면
