import { badgeArt, CATEGORY_ART, categoryIcon, confettiPiece, mascot, medal, uiIcon, type Kind, type Mood } from './art'

export type { Kind, Mood }
export { CATEGORY_ART, confettiPiece }

// The art is static, trusted markup from ./art, so it is injected as-is.
// The wrapper is `display: contents` (see .ic in tokens.css), so CSS sizes the <svg> as if it were a direct child.
function Art({ html, className }: { html: string; className?: string }) {
  return <span className={className ? `ic ${className}` : 'ic'} dangerouslySetInnerHTML={{ __html: html }} />
}

export const Mascot = ({ kind, face, mood = 'calm' }: { kind: Kind; face: string; mood?: Mood }) => (
  <Art html={mascot(kind, face, mood)} />
)

/** Category art for a stored category value (an emoji). The emoji itself is never shown. */
export const CategoryIcon = ({ category }: { category: string }) => <Art html={categoryIcon(category)} />

export const categoryLabel = (category: string) => CATEGORY_ART[category]?.label ?? 'Other'

export const BadgeArt = ({ badgeKey }: { badgeKey: string }) => <Art html={badgeArt(badgeKey)} />

export type UiIconName = 'sparkle' | 'trophy' | 'heart' | 'wheel' | 'receipt' | 'clock' | 'arrow' | 'plus' | 'lock' | 'star'

export const UiIcon = ({ name }: { name: UiIconName }) => <Art html={uiIcon(name)} />

export const Medal = ({ rank }: { rank: number }) => <Art html={medal(rank)} />
