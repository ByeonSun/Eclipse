# 작업 인수인계 — 하이 | 보스 참여 관리

다음에 이 프로젝트를 다시 열었을 때 처음부터 찾지 않도록, 현재 상태·결정 사항·작업 방법·남은 일을 한곳에 모은 문서입니다.
사용자용 설명(설치·운영 절차)은 [README.md](../README.md)에 있습니다. 이 문서는 **개발을 이어서 하는 사람/Claude** 용입니다.

마지막 정리: 2026-11-13

> **현재 Supabase 연동이 끊겨 있습니다 (2026-11-13, 사용자 요청).** 배포 사이트는 "Supabase 연결 설정이 필요합니다" 안내만 보여 줍니다.
> Supabase 프로젝트와 데이터는 지우지 않았습니다. 다시 쓰려면 아래 [11. 다시 연결하기](#11-supabase-다시-연결하기)를 따르세요.

---

## 1. 한눈에 보기

| 항목 | 값 |
|---|---|
| 서비스 | 하이 길드 보스 참여 관리 (관리자 전용) |
| 배포 주소 | https://high-guild.github.io/ |
| 저장소 | https://github.com/high-guild/high-guild.github.io (공개, GitHub 조직 `high-guild`, Free) |
| 로컬 폴더 | `D:\Projects\homepage\Eclips` (폴더 이름은 Eclips, 저장소 이름과 다름) |
| GitHub 계정 | 개인 `ByeonSun` (조직 `high-guild` 관리자) |
| Supabase | 조직 `ByeonSun's Org`(Free) / 프로젝트 `hai-guild` / ref `vprnskylhtqnmaavehoa` / **시드니 리전**(서울 아님) |
| Supabase URL | `https://vprnskylhtqnmaavehoa.supabase.co` (공개값) |
| 기술 | React 19 + TypeScript 7 + Vite 8, Supabase(Postgres+Auth), Tesseract.js 7, Vitest 5 |

### 2026-11-13 연동 해제 직전 DB 상태 (Supabase 에 그대로 남아 있음)
- 계정 1개(이메일 계정), 관리자 1명(그 이메일 계정)
- 아이디 `admin` 계정은 **만들지 않기로 함**(사용자 결정). 아이디 로그인 변환 코드(`src/lib/loginId.ts`)는 남아 있음
- 길드원 3명(모두 직업 선택됨), 보스 회차 0건, 참여 기록 0건
- 마이그레이션 1~5 모두 적용됨
- Free 프로젝트는 일주일 넘게 쓰지 않으면 **일시 정지**됨 → 다시 연결 전에 대시보드에서 Restore 필요할 수 있음
- 같은 조직에 예전 프로젝트 `ByeonSun's Project`(일시정지)가 있음 — 이 앱과 무관, 건드리지 않음

---

## 2. 사용자가 정한 것 (바꾸기 전에 확인할 것)

시간 순서. 뒤의 결정이 앞의 것을 덮습니다.

1. 원래 요구사항 전문은 로컬 `Prompt.txt` (커밋하지 않음). 핵심: 관리자 로그인, 캡처 붙여넣기→OCR→명단 대조→확인→레벨·처치시각→저장,
   유사도 결과 자동 확정 금지, 트랜잭션 저장, 재적 기간 기반 참여율, KST, RLS, GitHub Pages.
2. **참여율은 길드원 개인의 참여도**다. "전체" 표기는 "모든 레벨"(개인 레벨 합산)로 바꿈.
3. **길드 전체 참여율도 필요 — 기준은 한 주(KST 월요일 00:00 ~ 일요일 23:59)**. 대시보드 카드로 구현(◀▶ 지난 주).
   = 모든 길드원 참여 횟수 합 ÷ 참여 가능 횟수 합 (개인 평균 아님).
4. 저장소 공개 전환에 동의 (무료 플랜에서 Pages 쓰려고).
5. 도메인: `hi.github.io` 원했으나 GitHub 사용자 `hi`가 이미 있음 → **`high-guild`** 로 결정, 조직 생성 후 저장소 이전.
6. **관리자 로그인은 아이디 `admin`** 으로. Supabase는 이메일 형식이 필수라 앱이 `admin` → `admin@high-guild.github.io` 로 바꿔 로그인.
   이 주소는 메일함이 아님 → 아이디 계정은 비밀번호 찾기 메일 불가, 대시보드에서 재설정.
7. **별칭(OCR 별칭) 대신 직업 선택**: 소서리스·레인저·파이터·어쌔신. 별칭 테이블은 데이터 보존 차원에서 DB에 남겨둠(UI에서 제거).
8. **OCR 대상은 게임 화면 속 캐릭터 머리 위 이름표**(목록 글자가 아님). 이름표 모드를 기본으로.
9. Supabase/GitHub 모두 무료 플랜 유지 희망(“돈 안 드나?”).
10. **`admin` 아이디 계정은 만들지 않음.** 로그인 화면 라벨은 다시 "이메일"로 (아이디 변환 코드는 그대로 둠).
11. **Supabase 연동을 일단 끊음** — 나중에 필요하면 다시 연결. 프로젝트·데이터는 유지.

---

## 3. 코드 지도

```
src/
  App.tsx                  해시 라우팅 분기, 인증 상태별 화면
  main.tsx                 Provider 조립
  styles.css               디자인 토큰(:root) + 전체 스타일 (단일 파일)
  auth/AuthProvider.tsx    세션, 관리자 여부(rpc is_admin), 비밀번호 복구(?recovery=1, PKCE)
  data/RosterProvider.tsx  명단 캐시 + 매칭 인덱스
  lib/
    supabase.ts            클라이언트, 공개키만 허용(비밀키 감지 시 거부)
    api.ts                 모든 DB 호출 (1000행 제한 대비 allPages 페이지네이션)
    time.ts                KST 유틸, 기간(이번 주/달/전체/직접), kstWeekRange(월~일)
    stats.ts               참여율 표시(formatRate), 개인 집계, aggregateGuild(길드 전체)
    normalize.ts           닉네임 정규화(DB normalize_name 과 동일 규칙), OCR 줄 잡음 정리
    similarity.ts          similarity = OCR 오류 고려 유사도, plainSimilarity = 단순 자모 거리
    matching.ts            명단 대조. 글자목록 모드 matchOcrLines / 이름표 모드 matchNameTag,
                           finalAttendees(중복 제거), confidentSuggestion(일괄 적용 기준), searchMembers
    nameTags.ts            이름표 찾기(순수 함수): 색 규칙, 외곽선 게이트, 연결요소 → 상자
    ocr.ts                 Tesseract 워커 2개(kor+eng / kor), 취소, recognizeImage / recognizeNameTags(전처리 5종)
    memberImport.ts        줄바꿈·CSV 가져오기 파싱/검증 (직업 열)
    csv.ts                 CSV 파서/작성기, UTF-8 BOM, 수식 삽입 방지
    loginId.ts             아이디 ↔ 앱 전용 주소 변환
    errors.ts              Postgres/Auth 오류 → 한국어
    constants.ts           BOSS_LEVELS, JOBS, 이미지 제한 등
  pages/                   Dashboard, Record(기록 작성·수정), RunDetail, Sheet, History, Members, MemberDetail, Settings, AuthPages
  components/              Layout, MemberSearch(콤보박스), PeriodFilter, RegionSelector(영역 지정+이름표 표시),
                           ScreenCapture(getDisplayMedia), WeeklyGuildRate, ui(Notice/Dialog/Toast/useLatest)
supabase/migrations/       001 스키마, 002 무결성·감사·RLS, 003 RPC, 004 pg_safeupdate 수정, 005 직업
tests/db/                  embedded-postgres 로 마이그레이션 실제 적용 테스트, supabase-stub.sql, sql-safety 정적 검사
scripts/check-bundle.mjs   빌드 결과에 비밀키 없는지 검사 (CI)
.github/workflows/deploy.yml  테스트 → DB 테스트 → 빌드 → 비밀키 검사 → Pages 배포
samples/, public/__samples/   실제 게임 캡처(개인 화면). .gitignore 됨, 절대 커밋 금지
```

---

## 4. 로컬 개발 환경 (Windows)

- Node 26(winget `OpenJS.NodeJS.LTS`), git, gh 는 이번 작업 중 winget 으로 설치함. Python 3.12 있음(PIL 없음).
- **PowerShell 세션에 PATH 가 반영 안 돼 있을 수 있음** → 명령 앞에 항상:
  `$env:Path = [Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [Environment]::GetEnvironmentVariable("Path","User")`
- `gh` 는 ByeonSun 으로 로그인됨(keyring). 원격: `https://github.com/high-guild/high-guild.github.io.git`
- 로컬 연결값은 `.env.local.disabled` 로 이름을 바꿔 꺼 둠(gitignore). 다시 쓰려면 `.env.local` 로 되돌린다.
  되돌리면 로컬 `npm run dev` 가 실제 운영 DB에 붙는다 — 테스트 데이터 조심.
- 개발 서버: `.claude/launch.json` 의 `vite-dev` (port 5173). Claude 브라우저 패널은 `preview_start name=vite-dev`.
- 명령:
  ```
  npm test            # 단위 테스트 (56개)
  npm run test:db     # 실제 PostgreSQL 18 로 마이그레이션·RLS·RPC 테스트 (22개, 약 15초)
  npm run build       # tsc -b + vite build
  npx oxlint          # 경고만 있음(스타일), 오류 없음
  ```
- `Prompt.txt` 는 사용자의 원래 요구사항 원문. 커밋하지 않는다.

---

## 5. 배포

- `main` 에 push → GitHub Actions(`deploy.yml`) → 약 35초 후 https://high-guild.github.io/ 반영.
  확인: `gh run list --repo high-guild/high-guild.github.io --limit 1`
- 빌드 환경변수는 저장소 **Variables**(Secrets 아님, 공개값): `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`
  — **현재 두 값 모두 삭제된 상태**(연동 해제). 없으면 앱은 연결 안내 화면만 보여 준다.
- `base: './'` + 해시 라우팅이라 루트/하위 경로 모두 동작, 새로고침 404 없음.
- 배포 후 브라우저 캐시: 확인할 때 페이지 새로고침. 입력 중 화면은 beforeunload 경고가 있으니 자동화에선 navigate force.

---

## 6. DB 작업 방법 (중요)

### 규칙
- 스키마 변경은 **새 번호 마이그레이션 파일**로 추가 (`supabase/migrations/2026MMDD00000N_이름.sql`). 기존 파일은 수정하지 않는다
  (이미 운영 DB에 적용됨). 테스트는 디렉터리의 모든 파일을 순서대로 적용한다.
- **Supabase 는 API 요청에서 WHERE 없는 DELETE/UPDATE 를 거부한다(pg_safeupdate).** 로컬 Postgres 에는 이 확장이 없어서
  테스트로는 안 잡힘 → `tests/db/sql-safety.test.ts` 정적 검사가 막는다. 임시 표는 `TRUNCATE` 사용.
- 프로젝트 생성 시 "새 테이블 자동 노출" 을 껐다 → 새 테이블/함수는 `grant` 를 마이그레이션에 **명시**해야 한다.
- 쓰기 RPC 는 `security definer` + `assert_admin()`, 읽기 RPC 는 `security invoker` + `is_admin()` 검사.
  `auth.uid()` 만 신뢰. `audit_logs` 는 트리거만 작성.
- 회차·참여 테이블은 브라우저에서 직접 쓰기 권한 없음(RPC `save_boss_run`, `set_boss_run_cancelled` 만).

### 운영 DB 에 적용하는 법 (SQL Editor)
CLI/DB 비밀번호를 쓰지 않고 대시보드 SQL Editor 로 적용해 왔다.
1. 마이그레이션을 커밋·push.
2. Claude 브라우저 패널에서 `https://supabase.com/dashboard/project/vprnskylhtqnmaavehoa/sql/new` (사용자 로그인 세션 유지됨)
3. **Ctrl+V 붙여넣기는 패널의 Monaco 편집기에 안 들어간다.** 대신 페이지 JS로:
   ```js
   const r = await fetch('https://raw.githubusercontent.com/high-guild/high-guild.github.io/<커밋>/supabase/migrations/<파일>.sql')
   monaco.editor.getEditors()[0].setValue(await r.text())
   ```
4. Run 클릭. "RLS 없이 테이블 생성" 경고는 *Run and enable RLS*, "destructive operation" 경고는 함수 본문의 범위 DELETE/REVOKE 때문 → *Run query*.
5. 결과 확인은 `document.body.innerText` 에서 `Results` 이후를 읽는다.

### 읽기 전용 상태 확인 쿼리
```sql
select (select count(*) from auth.users) users,
       (select count(*) from auth.users where email like '%@high-guild.github.io') id_accounts,
       (select count(*) from public.admin_users) admins,
       (select count(*) from public.members) members,
       (select count(*) from public.boss_runs) runs,
       (select count(*) from public.attendances) attendances;
```

### 관리자 등록
```sql
insert into public.admin_users (user_id) select id from auth.users where email = 'admin@high-guild.github.io';
```
Auth 설정: 공개 가입 OFF, Site URL `https://high-guild.github.io/`, Redirect `https://high-guild.github.io/**` 하나만.

---

## 7. OCR 이름표 모드 — 설계와 측정 근거

### 실제 이름표 특징 (사용자 캡처 1장, 휴대폰 원본 2340×1080)
- 길드원 이름: **연한 남색 글자 + 진한 남색 외곽선**, 글자 높이 약 13~16px.
  HSV: H 216~228°, S 0.33~0.46, V 0.6~0.95
- 초록 이름(예: 폭주, 길드명 "하이"): H 112~125°, S 0.28~0.42, V 0.5~0.7
- 빛기둥 이펙트: H 196~203°, S 0.17~0.27 (채도 낮음) — 이름과 겹칠 수 있음
- 이미지 정답(원본 좌표 중심): 쿤츠(1420,81) 길드원(1168,368, 빛기둥 위) 구준표(441,597) 폭주(1366,528, 초록)
- 상단 "그랑"(대상 정보), "하이"(길드명, 초록), "안전/비보호"(지역 표시)는 길드원 이름이 아님

### 파이프라인 (`recognizeNameTags` → `matchNameTag`)
1. `detectNameTags`: 색 규칙(파랑·초록 프로필) ∧ 반경 2px 안에 어두운 픽셀(V<0.4) → 마스크 → 가로 ±6/세로 ±2 팽창 → 연결요소 → 크기 필터
2. 상자마다 **kor 전용 워커, PSM 7(한 줄)** 로 5가지 전처리 읽기:
   `hue3`, `hueWide3`, `hueWide4Thick`(획 1px 굵게), `otsu2`, `otsu3`(극성 자동 보정)
3. 판정: 읽기(또는 그 안의 단어)가 명단과 **정확히 같은 것이 2표 이상이고 다른 사람과 겹치지 않으면 정확 일치**.
   아니면 OCR 유사도 0.6 이상 추천(확인 필요). 추천도 없으면 공백·기호 없는 2~16자가 2번 이상 읽힌 경우만 미등록, 나머지는 버림.
4. UI: 이미지 위에 상태색 테두리+라벨, 「추천 1순위 모두 적용」(점수 ≥0.8, 2순위와 ≥0.1 차이).

### 측정 (같은 캡처를 100/85/70% 로 바꿔 4명 × 3 = 12건)
| 단계 | 결과 |
|---|---|
| 일반 문서 OCR | 0/4 (이름 하나도 못 찾음) |
| 이름표 1차 | 10/12 올바름, 정확 일치 2 |
| 이름표 개선(현재) | **12/12** 올바름(정확 일치 3 + 1순위 추천 9), 추천 점수 0.81~1.0, 미끼 이름 오추천 1건 |

배포 사이트에서 사용자 명단(길드원·지각)으로 확인: 4개 이름표 모두 검출, 길드원 1순위 88% → 일괄 적용 정상, 잡음 "아저"(=안전) 미등록 1건.

### 시도했지만 버린 것
- 전체 이미지 색 마스크 + PSM 11: 획이 얇아져 실패
- 색 거리 그레이스케일 맵: 오히려 나빠짐
- 명단 글자만 허용(`tessedit_char_whitelist`): Tesseract LSTM 에서 거의 효과 없음(신뢰도 0 잡음)
- kor+eng 혼합 워커로 이름표 읽기: 한글을 라틴으로(“AX”, “Ix”) 읽음 → kor 전용으로

### 알려진 한계
- 받침이 작은 글자(`쿤`)는 어떤 전처리로도 정확히 안 읽힘 → 추천으로만 처리(자동 확정 금지 규칙 유지)
- 흰색·빨간색 등 다른 색 이름표는 미지원 (프로필 추가 필요)
- 표본 1장. 보스전 이펙트·밤 배경·겹친 캐릭터는 미검증

### 튜닝하는 법 (실제 캡처로)
- 캡처는 `samples/` 에 저장(커밋 금지). 개발 서버로 보려면 `public/__samples/` 에도 복사 → `http://localhost:5173/__samples/파일`.
- 배포 사이트에 사용자가 붙여넣은 이미지는 `document.querySelector('.region img')` 로 접근 가능 — 페이지 안에서 실험하면 이미지가 밖으로 나가지 않음.
  배포 번들은 모듈을 노출하지 않으므로 Tesseract 는 `await import('https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.esm.min.js')`.
- 실험 틀: 같은 이미지를 여러 배율로 만들고(`drawImage` 축소) → 상자 검출 → 변형별 읽기 → 판정 → 정답 좌표와 비교, 잡음 수 집계.
  미끼 이름(구준희, 군자, 쿠키, 폭풍, 길동)을 명단에 섞어 오추천을 함께 본다.
- 재적용 검증: 새로고침하면 붙여넣은 이미지가 사라지므로 `sessionStorage` 에 dataURL 로 잠시 보관 → 새로고침 후
  `new ClipboardEvent('paste', { clipboardData })` 로 다시 붙여넣기. 끝나면 `sessionStorage.removeItem`.
- 브라우저 패널이 숨겨져 있으면 타이머가 느려져 긴 스크립트가 시간 초과 → 작업을 나눠 `window.__결과` 에 저장 후 읽기.

---

## 8. 검증 체크리스트 (배포 후)

1. `gh run list` 성공 확인
2. https://high-guild.github.io/ 새로고침 → 로그인 화면 / 로그인 상태면 대시보드
3. 공개키만으로 API 거부 확인(PowerShell `Invoke-WebRequest` 로 `/rest/v1/members` → 401)
4. 기록 작성: 캡처 붙여넣기 → 이름표 표시 → 추천 적용 → (테스트 시) 저장 후 반드시 테스트 데이터 정리
5. 테스트 데이터 정리는 SQL Editor 에서 **ID 지정 + 이름 조건**으로 삭제 (예: `nickname like '테스트\_%'`), 사용자에게 먼저 확인

---

## 9. 남은 일 (우선순위 순)

1. (사용자가 원할 때) Supabase 다시 연결 — 11장
2. 실제 캡처 추가 확보(보스전·밤·인원 많은 장면) 후 OCR 재측정·색 범위 조정. 필요하면 흰색 등 이름 색 프로필 추가.
3. 미검증: 비밀번호 재설정 메일 흐름, 설정 화면 비밀번호 변경, 화면의 회차 취소/복구 버튼, 휴대폰 실기기 화면.
4. 잡음 "안전"(→아저) 같은 지역 표시 글자 필터(위치나 단어 목록으로) 검토.
5. Supabase 리전이 시드니 — 느리면 서울 프로젝트로 이전 검토(데이터 백업·복구 절차는 README).
6. `member_aliases` 테이블은 미사용 상태로 남아 있음. 정리하려면 마이그레이션으로(데이터 확인 후).

---

## 10. 하지 말 것

- service_role / sb_secret 키, DB 비밀번호, 관리자 비밀번호를 코드·저장소·로그·채팅에 넣지 않는다 (공개키만 프런트엔드에).
- 실제 게임 캡처(`samples/`, `public/__samples/`)를 커밋하지 않는다.
- 유사도 결과를 자동 확정하지 않는다 (정확 일치 다수결만 자동 선택).
- 운영 DB 데이터를 사용자 확인 없이 삭제하지 않는다.
- 기존 마이그레이션 파일을 고쳐서 해결하지 않는다 (새 번호 파일로).

---

## 11. Supabase 다시 연결하기

연동 해제 때 한 일: ① 저장소 Variables 두 개 삭제 ② 로컬 `.env.local` → `.env.local.disabled` ③ 재배포.
Supabase 쪽(프로젝트, 데이터, Auth URL 설정, 관리자 등록)은 그대로 두었다. 다시 연결은 그 반대로 하면 된다.

1. Supabase 대시보드에서 `hai-guild` 프로젝트가 일시 정지(Paused) 상태면 **Restore** (사용자 계정 로그인 필요).
2. Project Settings → API Keys 에서 publishable 키 확인 (아래 값이 그대로면 그대로 사용).
   - URL: `https://vprnskylhtqnmaavehoa.supabase.co`
   - 공개키: `sb_publishable_sN8AA0FbMTWJJEiokC5wDw_QM2Mmh6d` (브라우저에 노출되는 공개용 키. RLS 가 데이터를 보호)
3. 저장소 Variables 다시 등록 후 재배포:
   ```
   gh variable set VITE_SUPABASE_URL --repo high-guild/high-guild.github.io --body "https://vprnskylhtqnmaavehoa.supabase.co"
   gh variable set VITE_SUPABASE_PUBLISHABLE_KEY --repo high-guild/high-guild.github.io --body "<publishable 키>"
   gh workflow run deploy.yml --repo high-guild/high-guild.github.io --ref main
   ```
4. 로컬 개발도 연결하려면 `.env.local.disabled` → `.env.local` 로 이름 변경.
5. Auth → URL Configuration 이 `https://high-guild.github.io/` / `https://high-guild.github.io/**` 인지 확인.
6. 새 마이그레이션이 생겼다면 6장 방법으로 SQL Editor 에 적용 후, 상태 확인 쿼리로 확인.
7. https://high-guild.github.io/ 새로고침 → 로그인 화면 → 이메일 관리자 계정으로 로그인 확인.

새 Supabase 프로젝트로 옮기는 경우: 마이그레이션 1~5 순서대로 적용, 공개 가입 OFF, URL 설정, 관리자 계정 생성 + admin_users 등록,
위 3번에 새 URL·키. 기존 데이터가 필요하면 README 의 백업·복구 절차.
