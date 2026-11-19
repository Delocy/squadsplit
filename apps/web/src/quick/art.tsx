// Small original SVG art for quick splits: a check mark and a round tick (the mockup's own; the shared art has no
// tick). The PAID stamp is the shared one, StampArt from design/icons. Never emoji.

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
