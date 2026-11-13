# 하이 | 보스 참여 관리 — 작업 안내

길드 보스 참여 기록 관리자 웹앱. 사용자와는 **한국어**로 소통한다.
전체 인수인계(상태·결정·DB 적용법·OCR 근거·남은 일)는 아래 문서에 있다. 작업 전에 먼저 읽는다.

@docs/HANDOFF.md

> **Supabase 연동이 끊겨 있다(2026-11-13, 사용자 요청).** 사이트는 연결 안내만 보여 준다. 다시 연결은 HANDOFF 11장.

## 바로 쓰는 정보
- 배포: https://high-guild.github.io/ · 저장소: `high-guild/high-guild.github.io` (main push → Actions 로 자동 배포, 약 35초)
- Supabase 프로젝트 ref `vprnskylhtqnmaavehoa` (시드니). 운영 DB 변경은 **새 번호 마이그레이션 파일 + SQL Editor 적용**.
- PowerShell 명령 전 PATH 갱신:
  `$env:Path = [Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [Environment]::GetEnvironmentVariable("Path","User")`
- 확인 명령: `npm test` (단위) · `npm run test:db` (실제 Postgres) · `npm run build`

## 꼭 지킬 것
- 참여율은 **길드원 개인** 기준. 길드 전체 참여율은 **KST 월~일 주간** 합계 방식(평균 아님).
- 유사도 결과는 자동 확정하지 않는다. OCR 이름표는 정확 일치 2표 이상만 자동 선택.
- Supabase 는 WHERE 없는 DELETE/UPDATE 를 거부한다(pg_safeupdate) — `tests/db/sql-safety.test.ts` 가 검사.
- 새 테이블·함수는 grant 를 마이그레이션에 명시(자동 노출 꺼짐).
- 비밀키·비밀번호·실제 게임 캡처(`samples/`)·`Prompt.txt` 는 커밋하지 않는다.
- 운영 DB 데이터 삭제는 사용자 확인 후, ID 지정으로만.
