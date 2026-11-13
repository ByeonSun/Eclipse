/** 독자 제작 워드마크: 초승달과 별을 겹친 문장(紋章) + "하이" */
export function Sigil({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="hai-gold" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff2cf" />
          <stop offset="0.5" stopColor="#e3c98d" />
          <stop offset="1" stopColor="#8a6a2f" />
        </linearGradient>
      </defs>
      <path
        d="M32 3 L59 18 V46 L32 61 L5 46 V18 Z"
        fill="#121215"
        stroke="url(#hai-gold)"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      <path d="M32 9 L53 21 V43 L32 55 L11 43 V21 Z" fill="none" stroke="#c3c7ce" strokeOpacity="0.35" strokeWidth="1" />
      <path
        d="M38 16 a16 16 0 1 0 0 32 a12.5 12.5 0 1 1 0 -32 z"
        fill="url(#hai-gold)"
        transform="translate(-4 0)"
      />
      <path d="M40 26 l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2 z" fill="#f4f1ea" />
    </svg>
  )
}

export function Wordmark({ large, sub = true }: { large?: boolean; sub?: boolean }) {
  return (
    <span className={`wordmark${large ? ' wordmark--large' : ''}`}>
      <Sigil className="wordmark__sigil" />
      <span className="wordmark__name">하이</span>
      {sub && !large && <span className="wordmark__sub">보스 참여 관리</span>}
    </span>
  )
}
