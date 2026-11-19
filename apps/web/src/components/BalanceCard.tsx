import { formatMoney } from '@squadsplit/shared'
import { avatarFor } from '../design/Avatar'
import { Mascot, type Mood } from '../design/icons'

const QUIPS = {
  owed: ['The group owes you. Enjoy it while it lasts.', 'Collecting season.', "You're the group's bank right now."],
  owe: ['Time to pay up.', "You're in the red. Settle when you can.", 'Your friends have noticed.'],
  even: ['All settled. Nothing to do here.', 'Zero debt, zero drama.', 'Clean slate.'],
}

/**
 * Your balance in the group, with your mascot in a matching mood: it bobs when you're owed or square,
 * and shivers when you owe. `seed` picks the quip, so it changes as the group's history grows.
 */
export function BalanceCard({ cents, currency, userId, seed }: { cents: number; currency: string; userId: string; seed: number }) {
  const kind = cents > 0 ? 'owed' : cents < 0 ? 'owe' : 'even'
  const mood: Mood = kind === 'owed' ? 'happy' : kind === 'owe' ? 'nervous' : 'calm'
  const look = avatarFor(userId)
  const quips = QUIPS[kind]
  return (
    <section className={`card balance ${kind}`} aria-label="Your balance">
      <div className="buddy">
        <Mascot kind={look.kind} face={look.face} mood={mood} />
      </div>
      <div>
        <div className="lbl">{kind === 'owed' ? "You're owed" : kind === 'owe' ? 'You owe' : 'Your balance'}</div>
        <div className="amt">{kind === 'even' ? 'All square' : formatMoney(Math.abs(cents), currency)}</div>
        <div className="quip">{quips[seed % quips.length]}</div>
      </div>
    </section>
  )
}
