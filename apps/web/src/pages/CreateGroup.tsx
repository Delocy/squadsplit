import { CreateGroupInput, CURRENCIES, type Currency, type GroupDTO } from '@squadsplit/shared'
import { useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { useApi } from '../api'
import { ErrorNote } from '../components/ErrorNote'
import { NamesField, useNamesDraft } from '../components/NamesField'
import { NICKNAME_HINT, NicknameField, useNicknameDraft } from '../components/NicknameField'
import { PageLink, usePageNavigate } from '../components/PageLink'
import { BusyLabel } from '../design/Busy'
import { UiIcon } from '../design/icons'
import { queryKeys } from '../queryKeys'
import { useSingleFlightMutation } from '../singleFlight'
import { useMe } from '../useProfileRefresh'

// The API requires an emoji for every group. The UI never shows it, so every group gets the same one.
const GROUP_EMOJI = '🧡'

export function CreateGroup() {
  const api = useApi()
  const navigate = usePageNavigate()
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [currency, setCurrency] = useState<Currency>('SGD')
  const profileName = useMe().data?.displayName ?? ''
  const nickname = useNicknameDraft(profileName)
  const names = useNamesDraft()
  const [formError, setFormError] = useState<string | null>(null)

  const create = useSingleFlightMutation({
    mutationFn: (input: CreateGroupInput) => api.post<GroupDTO>('/groups', input),
    onSuccess: (group) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.groups })
      navigate(`/groups/${group.id}`)
    },
  })

  function submit(e: FormEvent) {
    e.preventDefault()
    setFormError(null)
    // A name still in the box goes along too; one the API would refuse stops here with its hint.
    const members = names.withPending()
    if (members === null) return
    // Your nickname goes along only if you changed it from your profile name.
    const parsed = CreateGroupInput.safeParse({
      name,
      emoji: GROUP_EMOJI,
      currency,
      ...(nickname.change !== undefined && { nickname: nickname.change }),
      ...(members.length > 0 && { members }),
    })
    if (!parsed.success) {
      if (!name.trim()) setFormError('Give the group a name.')
      else if (nickname.invalid) setFormError(NICKNAME_HINT)
      else setFormError('Keep the name to 50 characters or fewer.')
      return
    }
    create.mutate(parsed.data)
  }

  return (
    <main className="narrow page">
      <form className="card" onSubmit={submit} noValidate>
        <h3>
          <UiIcon name="sparkle" />
          New group
        </h3>
        <label className="f" htmlFor="group-name">
          Group name
        </label>
        <input
          id="group-name"
          type="text"
          maxLength={50}
          placeholder="Bali trip, flat bills, Friday dinners…"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
        <label className="f" htmlFor="group-currency">
          Currency
        </label>
        <select id="group-currency" value={currency} onChange={(e) => setCurrency(e.target.value as Currency)}>
          {CURRENCIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <NicknameField id="group-nickname" value={nickname.value} placeholder={profileName} onChange={nickname.setValue} />
        <NamesField id="group-names" draft={names} />
        {formError ? (
          <p className="err" role="alert">
            {formError}
          </p>
        ) : (
          <ErrorNote error={create.error} />
        )}
        <div className="form-f">
          <PageLink to="/groups" className="btn ghost">
            Cancel
          </PageLink>
          <button type="submit" className="btn primary" disabled={create.isPending}>
            <BusyLabel busy={create.isPending} label="Creating…">
              Create group
            </BusyLabel>
          </button>
        </div>
      </form>
    </main>
  )
}
