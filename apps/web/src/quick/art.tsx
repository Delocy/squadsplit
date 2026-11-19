// Small original SVG art for quick splits: a check mark and a round tick. Never emoji.

/** A plain check mark in the current text colour. */
export const Check = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

/** A mint circle with a plum tick: someone has paid. */
export const PaidTick = ({ className = 'pub-tick' }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="10" fill="#b8f2d8" stroke="#3d2c42" strokeWidth="2" />
    <path d="M7 12.5l3.4 3.4L17.2 9" fill="none" stroke="#3d2c42" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

/** A tilted rubber-stamp PAID, for a split everyone has paid. */
export const PaidStamp = () => (
  <svg className="paid-stamp" viewBox="0 0 120 52" role="img" aria-label="Everyone's paid">
    <g transform="rotate(-8 60 26)">
      <rect x="6" y="6" width="108" height="40" rx="9" fill="none" stroke="#e0457f" strokeWidth="4" />
      <rect x="12" y="12" width="96" height="28" rx="5" fill="none" stroke="#e0457f" strokeWidth="1.6" strokeDasharray="3 3" />
      <text x="60" y="35" textAnchor="middle" fontFamily="Fredoka, sans-serif" fontWeight="700" fontSize="22" letterSpacing="4" fill="#e0457f">
        PAID
      </text>
    </g>
  </svg>
)
