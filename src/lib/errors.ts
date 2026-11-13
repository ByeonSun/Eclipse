interface PgLikeError {
  message?: string
  code?: string
  hint?: string | null
  details?: string | null
  status?: number
  name?: string
}

/** Supabase/PostgREST/Auth 오류를 한국어 안내로 */
export function errorMessage(e: unknown): string {
  if (!e) return '알 수 없는 오류가 발생했습니다.'
  if (typeof e === 'string') return e
  const err = e as PgLikeError
  const msg = err.message ?? ''
  if (/Failed to fetch|NetworkError|Load failed|fetch failed/i.test(msg)) {
    return '서버에 연결하지 못했습니다. 인터넷 연결이나 Supabase 상태를 확인하세요.'
  }
  if (/Invalid login credentials/i.test(msg)) return '이메일 또는 비밀번호가 올바르지 않습니다.'
  if (/Email not confirmed/i.test(msg)) return '이메일 인증이 완료되지 않은 계정입니다.'
  if (/rate limit|too many/i.test(msg)) return '요청이 너무 많습니다. 잠시 후 다시 시도하세요.'
  if (/New password should be different/i.test(msg)) return '새 비밀번호가 기존 비밀번호와 같습니다.'
  if (/Password should be at least/i.test(msg)) return '비밀번호가 너무 짧습니다. Supabase 비밀번호 정책을 확인하세요.'
  if (/JWT expired|session.*(missing|expired)/i.test(msg)) return '로그인이 만료되었습니다. 다시 로그인하세요.'
  switch (err.code) {
    case '42501':
      return msg.includes('관리자') ? msg : '권한이 없습니다. 관리자 계정으로 로그인했는지 확인하세요.'
    case '23505':
      if (/[가-힣]/.test(msg)) return msg
      if (/normalized_nickname/.test(msg)) return '같은 닉네임(정규화 기준)이 이미 등록되어 있습니다.'
      if (/normalized_alias/.test(msg)) return '같은 별칭이 이미 다른 길드원에게 등록되어 있습니다.'
      return '이미 존재하는 값입니다.'
    case '23503':
      if (/[가-힣]/.test(msg)) return msg
      return '참여 기록이 있어 삭제할 수 없습니다. 대신 비활성 처리하세요.'
    case '23P01':
      return '재적 기간이 기존 기간과 겹칩니다.'
    case '23514':
      if (/membership_periods_order/.test(msg)) return '탈퇴 시각은 가입 시각보다 늦어야 합니다.'
      return msg
    case 'PGRST301':
    case 'PGRST303':
      return '로그인이 만료되었습니다. 다시 로그인하세요.'
  }
  return msg || '알 수 없는 오류가 발생했습니다.'
}

export function isMembershipConflict(e: unknown): boolean {
  const err = e as PgLikeError
  return err?.hint === 'membership_conflict'
}
