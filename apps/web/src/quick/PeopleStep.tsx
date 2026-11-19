import { QUICK_SPLIT_MAX_PEOPLE } from '@squadsplit/shared'
import { useState, type Dispatch, type KeyboardEvent, type SetStateAction } from 'react'
import { Avatar } from '../design/Avatar'
import { UiIcon } from '../design/icons'
import { MEMBER_NAME_HINT, MEMBER_NAME_MAX, parseMemberName } from '../memberName'
import { addPerson, removePerson, type QuickDraft } from './draft'
import { useQuickSplits } from './quickData'

type SetDraft = Dispatch<SetStateAction<QuickDraft>>

const SUGGESTIONS = 6
const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

/** Names from your recent quick splits (never yours), newest first, leaving out anyone already in. */
function useSuggestions(draft: QuickDraft): string[] {
  const recent = useQuickSplits().data ?? []
  const out: string[] = []
  for (const name of recent.flatMap((s) => s.names.slice(1))) {
    if (draft.people.some((p) => sameName(p.name, name)) || out.some((n) => sameName(n, name))) continue
    out.push(name)
  }
  return out.slice(0, SUGGESTIONS)
}

/** Step 2: who's splitting, typed as chips. Nobody needs an account; each gets an animal just for this split. */
export function PeopleStep({ draft, setDraft }: { draft: QuickDraft; setDraft: SetDraft }) {
  const [text, setText] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const suggestions = useSuggestions(draft)
  const full = draft.people.length >= QUICK_SPLIT_MAX_PEOPLE
  const [me, ...others] = draft.people

  function add(raw: string) {
    if (!raw.trim()) return
    const name = parseMemberName(raw)
    if (name === null) return setProblem(MEMBER_NAME_HINT)
    if (draft.people.some((p) => sameName(p.name, name))) return setProblem(`${name} is already in. Add them under another name.`)
    if (full) return
    setDraft((d) => addPerson(d, name))
    setText('')
    setProblem(null)
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return
    e.preventDefault()
    add(text)
  }

  return (
    <section className="card">
      <h3>
        <UiIcon name="heart" />
        Who's splitting?
      </h3>
      <ul className="qs-chips" aria-label="Who's splitting">
        <li className="qs-chip me">
          <Avatar avatar={me!.avatar} size="sm" mood="happy" />
          <span>You</span>
        </li>
        {others.map((p) => (
          <li key={p.key} className="qs-chip">
            <Avatar avatar={p.avatar} size="sm" />
            <span>{p.name}</span>
            <button type="button" className="chip-x" aria-label={`Remove ${p.name}`} onClick={() => setDraft((d) => removePerson(d, p.key))}>
              <svg viewBox="0 0 12 12" aria-hidden="true">
                <path d="M3 3l6 6M9 3l-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </li>
        ))}
      </ul>
      <div className="qs-add">
        <input
          type="text"
          aria-label="Add a name"
          maxLength={MEMBER_NAME_MAX}
          autoComplete="off"
          placeholder={full ? '' : 'Add a name…'}
          value={text}
          disabled={full}
          onChange={(e) => {
            setText(e.target.value)
            setProblem(null)
          }}
          onKeyDown={onKeyDown}
        />
        <button type="button" className="btn" disabled={full || !text.trim()} onClick={() => add(text)}>
          Add
        </button>
      </div>
      {full && <p className="s">That's {QUICK_SPLIT_MAX_PEOPLE} people, the most a quick split holds.</p>}
      {problem && (
        <p className="err" role="alert">
          {problem}
        </p>
      )}
      {suggestions.length > 0 && !full && (
        <>
          <span className="f">From recent quick splits</span>
          <div className="qs-chips" role="group" aria-label="From recent quick splits">
            {suggestions.map((name) => (
              <button type="button" key={name} className="qs-chip ghost" onClick={() => add(name)}>
                + {name}
              </button>
            ))}
          </div>
        </>
      )}
      <label className="f" htmlFor="qs-my-name">
        Your name on the card
      </label>
      <input
        id="qs-my-name"
        type="text"
        maxLength={MEMBER_NAME_MAX}
        value={me!.name}
        onChange={(e) => setDraft((d) => ({ ...d, people: d.people.map((p, i) => (i === 0 ? { ...p, name: e.target.value } : p)) }))}
      />
      <div className="note-box">
        <UiIcon name="lock" />
        <div>No accounts needed. Everyone gets an animal just for this split. Your link shows first names and amounts, nothing else.</div>
      </div>
    </section>
  )
}
