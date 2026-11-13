export const BOSS_LEVELS = [40, 45, 50, 55, 60, 65, 70, 75, 80, 85] as const
export type BossLevel = (typeof BOSS_LEVELS)[number]

export function isBossLevel(n: number): n is BossLevel {
  return (BOSS_LEVELS as readonly number[]).includes(n)
}

/** 길드원 직업 (DB members_job_allowed 제약과 같은 값) */
export const JOBS = ['소서리스', '레인저', '파이터', '어쌔신'] as const
export type Job = (typeof JOBS)[number]
export function isJob(v: string): v is Job {
  return (JOBS as readonly string[]).includes(v)
}

export const APP_TITLE = '하이 | 보스 참여 관리'
/** 참여율은 길드 전체가 아니라 길드원 개인의 참여도다 */
export const RATE_BASIS_NOTE = '길드원 개인 참여율 · 등록된 보스 회차 기준'

/** OCR 입력 이미지 제한 */
export const MAX_IMAGE_BYTES = 15 * 1024 * 1024
export const MAX_IMAGE_PIXELS = 40_000_000
export const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/bmp', 'image/gif']
