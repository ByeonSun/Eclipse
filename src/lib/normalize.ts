/**
 * 닉네임 정규화 키 — DB 의 public.normalize_name() 과 같은 규칙.
 *  - 유니코드 NFC
 *  - 연속 공백/줄바꿈 → 공백 하나, 앞뒤 공백 제거 (내부 공백은 유지)
 *  - 라틴 문자 소문자
 *  - 숫자·특수문자는 지우지 않는다
 */
export function normalizeName(s: string): string {
  return s.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase()
}

/**
 * OCR 한 줄의 명백한 잡음만 정리한다.
 *  - 제어문자/제로폭 문자 제거
 *  - 줄 앞뒤에 붙은 표 테두리·불릿 기호(| ¦ • · ▶ ※ 등) 제거
 * 닉네임 안쪽의 숫자, 특수문자, 공백은 건드리지 않는다.
 */
export function cleanOcrLine(s: string): string {
  return s
    .normalize('NFC')
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F​-‍﻿]/g, '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/^[\s|¦│┃•·∙●○◆◇▶▷►※:;,'"`~\-–—_=]+/u, '')
    .replace(/[\s|¦│┃•·∙●○◆◇◀◁◄※:;,'"`~\-–—_=]+$/u, '')
    .replace(/\s+/g, ' ')
    .trim()
}
