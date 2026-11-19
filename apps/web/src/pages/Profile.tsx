import { useAuth } from '@clerk/react'
import { defaultAvatar, sameAvatar, type AvatarChoice, type MeDTO, type UpdateProfileInput } from '@squadsplit/shared'
import { useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { useApi } from '../api'
import { AvatarPicker, YouPreview } from '../components/AvatarPicker'
import { ErrorNote } from '../components/ErrorNote'
import { PageLink } from '../components/PageLink'
import { BusyLabel } from '../design/Busy'
import { UiIcon } from '../design/icons'
import { queryKeys } from '../queryKeys'
import { useSingleFlightMutation } from '../singleFlight'
import { useMe } from '../useProfileRefresh'

/**
 * `/me`: your profile look. It shows outside groups (the top bar on your groups list), and new groups start you on
 * it. It's yours alone, so every look is open; inside each group you still pick your own.
 */
export function Profile() {
  const api = useApi()
  const userId = useAuth().userId ?? ''
  const queryClient = useQueryClient()
  const me = useMe().data
  const current = me?.profileAvatar ?? defaultAvatar(userId)
  const [choice, setChoice] = useState<AvatarChoice | null>(null)
  const avatar = choice ?? current
  const dirty = !sameAvatar(avatar, current)

  const save = useSingleFlightMutation({
    mutationFn: (input: UpdateProfileInput) => api.patch<MeDTO>('/me', input),
    onSuccess: (saved) => {
      queryClient.setQueryData(queryKeys.me(userId), saved)
      setChoice(null)
    },
  })

  function submit(e: FormEvent) {
    e.preventDefault()
    save.mutate({ profileAvatar: avatar })
  }

  return (
    <main className="narrow page">
      <div className="page-h">
        <h2>Your profile look</h2>
        <PageLink to="/groups" className="btn small ghost">
          Back to your groups
        </PageLink>
      </div>
      <section className="card" aria-labelledby="profile-look-h">
        <h3 id="profile-look-h">
          <UiIcon name="star" />
          Your animal
        </h3>
        <p className="s">Shown outside your groups, and where new groups start you. Each group can still see you differently.</p>
        <form className="you-fields" onSubmit={submit} noValidate>
          <YouPreview avatar={avatar} name={me?.displayName ?? ''} />
          <AvatarPicker value={avatar} taken={[]} onChange={setChoice} />
          <div className="form-f">
            {save.isSuccess && !dirty && (
              <span className="s" role="status">
                Saved
              </span>
            )}
            <button className="btn primary" type="submit" disabled={save.isPending || !dirty}>
              <BusyLabel busy={save.isPending} label="Saving…">
                Save
              </BusyLabel>
            </button>
          </div>
        </form>
        {save.isError && <ErrorNote error={save.error} />}
      </section>
    </main>
  )
}
