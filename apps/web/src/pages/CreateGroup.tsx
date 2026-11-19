import { CreateGroupInput, CURRENCIES, type Currency, type GroupDTO } from '@squadsplit/shared'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { useApi } from '../api'
import { ErrorNote } from '../components/ErrorNote'
import { UiIcon } from '../design/icons'
import { queryKeys } from '../queryKeys'

// The API requires an emoji for every group. The UI never shows it, so every group gets the same one.
const GROUP_EMOJI = '🧡'

export function CreateGroup() {
  const api = useApi()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [currency, setCurrency] = useState<Currency>('SGD')
  const [formError, setFormError] = useState<string | null>(null)

  const create = useMutation({
    mutationFn: (input: CreateGroupInput) => api.post<GroupDTO>('/groups', input),
    onSuccess: (group) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.groups })
      navigate(`/groups/${group.id}`)
    },
  })

  function submit(e: FormEvent) {
    e.preventDefault()
    setFormError(null)
    const parsed = CreateGroupInput.safeParse({ name, emoji: GROUP_EMOJI, currency })
    if (!parsed.success) {
      setFormError(name.trim() ? 'Keep the name to 50 characters or fewer.' : 'Give the group a name.')
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
        {formError ? (
          <p className="err" role="alert">
            {formError}
          </p>
        ) : (
          <ErrorNote error={create.error} />
        )}
        <div className="form-f">
          <Link to="/groups" className="btn ghost">
            Cancel
          </Link>
          <button type="submit" className="btn primary" disabled={create.isPending}>
            {create.isPending ? 'Creating…' : 'Create group'}
          </button>
        </div>
      </form>
    </main>
  )
}
