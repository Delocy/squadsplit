import { forwardRef, useEffect, useRef, useState, type RefObject } from 'react'
import { LogoPup } from '../components/Logo'
import { Avatar } from '../design/Avatar'
import { BusyLabel } from '../design/Busy'
import { UiIcon } from '../design/icons'
import { Check } from './art'
import { chargesMath, dayLabel, dishLabel, guestsOf, money, multiplierNote, payerOf, shareCardText, shortLink, type SplitView } from './format'
import { deliverCardImage, renderCardImage } from './saveImage'
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
 * `link` is null once sharing has stopped or expired: the card then offers no link.
 */
export const ShareCard = forwardRef<HTMLElement, { split: SplitView; link: string | null }>(function ShareCard({ split, link }, ref) {
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
        {link ? `Tick yours: ${shortLink(link)}` : 'Split with SquadSplit'}
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

const CANT_DRAW = "Couldn't make the image. Take a screenshot of the card instead."

/**
 * The card's PNG, drawn whenever the card shows or what it shows changes (`key`), so Save image never has to wait.
 * Null until it is ready; a failure leaves it null, and the tap tries again.
 */
function useCardImage(card: RefObject<HTMLElement | null>, title: string, key: string): { key: string; file: File } | null {
  const [image, setImage] = useState<{ key: string; file: File } | null>(null)
  useEffect(() => {
    let stale = false
    const draw = async () => {
      await document.fonts?.ready // so the PNG has the card's own fonts
      if (stale || !card.current) return
      const file = await renderCardImage(card.current, title)
      if (!stale) setImage({ key, file })
    }
    draw().catch(() => {})
    return () => {
      stale = true
    }
  }, [card, title, key])
  return image?.key === key ? image : null
}

/**
 * The card with Copy text, Copy link and Save image. Copy text also shows the text and how it looks in a chat (5b).
 * `link` is null once sharing has stopped: then there's no Copy link, and the text ends without one.
 */
export function ShareCardWithActions({ split, link }: { split: SplitView; link: string | null }) {
  const card = useRef<HTMLElement>(null)
  const [showText, setShowText] = useState(false)
  const [note, setNote] = useState<Note>(null)
  const [saving, setSaving] = useState(false)
  const text = shareCardText(split, link)
  const image = useCardImage(card, split.title, `${text}\n${JSON.stringify(split.people.map((p) => p.avatar))}`)

  async function copyText() {
    setShowText(true)
    setNote((await copy(text)) ? { kind: 'ok', text: 'Copied. Paste it into your chat.' } : { kind: 'err', text: "Couldn't copy. Select the text below and copy it." })
  }

  async function copyLink() {
    if (!link) return
    setNote((await copy(link)) ? { kind: 'ok', text: 'Link copied. Paste it into your chat.' } : { kind: 'err', text: `Couldn't copy. The link is ${link}` })
  }

  // Called straight from the tap, so with a ready image the share sheet opens inside it.
  async function deliver(file: File) {
    if ((await deliverCardImage(file, split.title)) === 'downloaded') setNote({ kind: 'ok', text: 'Saved the card as an image.' })
  }

  function saveImage() {
    if (image) return void deliver(image.file)
    // Not drawn yet (or the early try failed): draw it now. The tap's moment is gone by then, so a refused share
    // sheet falls back to a download.
    if (!card.current) return
    setSaving(true)
    renderCardImage(card.current, split.title)
      .then(deliver)
      .catch(() => setNote({ kind: 'err', text: CANT_DRAW }))
      .finally(() => setSaving(false))
  }

  return (
    <>
      <ShareCard ref={card} split={split} link={link} />
      <div className="qs-actions" role="group" aria-label="Share the card">
        <button type="button" className="btn" onClick={copyText}>
          <UiIcon name="receipt" />
          Copy text
        </button>
        {link && (
          <button type="button" className="btn" onClick={copyLink}>
            <UiIcon name="heart" />
            Copy link
          </button>
        )}
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
                {`${text.split('\n').slice(0, 6).join('\n')}…${link ? '\n' : ''}`}
                {link && <u>{shortLink(link)}</u>}
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
