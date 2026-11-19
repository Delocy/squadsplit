import { forwardRef, useRef, useState } from 'react'
import { LogoPup } from '../components/Logo'
import { Avatar } from '../design/Avatar'
import { BusyLabel } from '../design/Busy'
import { UiIcon } from '../design/icons'
import { Check } from './art'
import { chargesMath, dayLabel, dishLabel, guestsOf, money, multiplierNote, payerOf, shareCardText, shortLink, type SplitView } from './format'
import { saveCardImage } from './saveImage'
import './quick.css'

/** "Satay ÷3 $6.68 · Chilli crab ÷3 $16.00". */
export const dishesLine = (s: SplitView, dishes: SplitView['people'][number]['dishes']) =>
  dishes.map((d) => `${dishLabel(d)} ${money(s, d.shareCents)}`).join(' · ')

/** The title, place and date, and who paid how much: the top of the card and of the share link page. */
export function CardHeader({ split }: { split: SplitView }) {
  const payer = payerOf(split)
  return (
    <div className="qs-card-h">
      <div className="grow">
        <div className="qs-title">{split.title}</div>
        <div className="qs-sub">{[split.place, dayLabel(split.spentOn)].filter(Boolean).join(' · ')}</div>
      </div>
      <div className="qs-paid">
        <span>{payer.name} paid</span>
        <b>{money(split, split.totalCents)}</b>
      </div>
    </div>
  )
}

/**
 * The share card: everyone's dishes and total, how the charges were added, and who pays the payer what. A fixed light
 * card (about 520px tall at 375px wide for a lunch for three), so one screenshot holds it, even in dark mode.
 */
export const ShareCard = forwardRef<HTMLElement, { split: SplitView; link: string }>(function ShareCard({ split, link }, ref) {
  const payer = payerOf(split)
  const note = multiplierNote(split)
  return (
    <section ref={ref} className="qs-card" aria-label="Share card">
      <CardHeader split={split} />
      <ul className="qs-people">
        {split.people.map((p) => (
          <li key={p.id} className={p.id === split.payerId ? 'payer' : undefined}>
            <Avatar avatar={p.avatar} mood={p.id === split.payerId ? 'happy' : 'calm'} />
            <div className="grow">
              <div className="nm">
                {p.name}
                {p.id === split.payerId && <em>Paid</em>}
              </div>
              <div className="dishes-l">{dishesLine(split, p.dishes)}</div>
            </div>
            <b>{money(split, p.totalCents)}</b>
          </li>
        ))}
      </ul>
      <div className="qs-math">
        {chargesMath(split)}.{note && ` ${note}`}
      </div>
      <div className="qs-pay">
        <span className="lbl">Pay {payer.name}</span>
        <b>{guestsOf(split).map((p) => `${p.name} ${money(split, p.totalCents)}`).join(' · ')}</b>
      </div>
      <div className="qs-foot">
        <span className="qs-mark">
          <LogoPup />
        </span>
        Tick yours: {shortLink(link)}
      </div>
    </section>
  )
})

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

type Note = { kind: 'ok' | 'err'; text: string } | null

/** The card with Copy text, Copy link and Save image. Copy text also shows the text and how it looks in a chat (5b). */
export function ShareCardWithActions({ split, link }: { split: SplitView; link: string }) {
  const card = useRef<HTMLElement>(null)
  const [showText, setShowText] = useState(false)
  const [note, setNote] = useState<Note>(null)
  const [saving, setSaving] = useState(false)
  const text = shareCardText(split, link)

  async function copyText() {
    setShowText(true)
    setNote((await copy(text)) ? { kind: 'ok', text: 'Copied. Paste it into your chat.' } : { kind: 'err', text: "Couldn't copy. Select the text below and copy it." })
  }

  async function copyLink() {
    setNote((await copy(link)) ? { kind: 'ok', text: 'Link copied. Paste it into your chat.' } : { kind: 'err', text: `Couldn't copy. The link is ${link}` })
  }

  async function saveImage() {
    if (!card.current) return
    setSaving(true)
    try {
      const how = await saveCardImage(card.current, split.title)
      if (how === 'downloaded') setNote({ kind: 'ok', text: 'Saved the card as an image.' })
    } catch (err) {
      setNote({ kind: 'err', text: err instanceof Error ? err.message : "Couldn't save the image." })
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <ShareCard ref={card} split={split} link={link} />
      <div className="qs-actions">
        <button type="button" className="btn" onClick={copyText}>
          <UiIcon name="receipt" />
          Copy text
        </button>
        <button type="button" className="btn" onClick={copyLink}>
          <UiIcon name="heart" />
          Copy link
        </button>
        <button type="button" className="btn primary" onClick={saveImage} disabled={saving}>
          <BusyLabel busy={saving} label="Saving…">
            <UiIcon name="star" />
            Save image
          </BusyLabel>
        </button>
      </div>
      {note &&
        (note.kind === 'ok' ? (
          <div className="qs-toast" role="status">
            <Check />
            {note.text}
          </div>
        ) : (
          <p className="err" role="alert">
            {note.text}
          </p>
        ))}
      {showText ? (
        <>
          <section className="card" aria-label="Copy as text">
            <h3>
              <UiIcon name="receipt" />
              Copy as text
            </h3>
            <pre className="qs-text">{text}</pre>
            <div className="qs-actions">
              <button type="button" className="btn small" onClick={copyText}>
                Copy again
              </button>
              <button type="button" className="btn small ghost" onClick={() => setShowText(false)}>
                Back to the card
              </button>
            </div>
          </section>
          <section className="card qs-chat" aria-label="How it looks in a chat">
            <span className="lbl">How it looks in a chat</span>
            <div className="bubble">
              <pre>
                {`${text.split('\n').slice(0, 6).join('\n')}…\n`}
                <u>{shortLink(link)}</u>
              </pre>
            </div>
          </section>
        </>
      ) : (
        <p className="qs-hint">Post the screenshot and the link in your group chat. Friends tick themselves off, no sign-in needed.</p>
      )}
    </>
  )
}
