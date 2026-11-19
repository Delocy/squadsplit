/** A plain-language error line. `error` is usually an ApiError, whose message comes from the API. */
export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return <p className="err" />
  const message = error instanceof Error ? error.message : 'Something went wrong.'
  return (
    <p className="err" role="alert">
      {message}
    </p>
  )
}
