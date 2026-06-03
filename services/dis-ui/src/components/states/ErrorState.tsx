// Reusable error state (surface map 6.4). Named ErrorState (not Error) to avoid
// shadowing the global. Surface Map is not in the repo, so the exact visual is
// provisional.
export function ErrorState({
  message = 'Something went wrong.',
  onRetry,
}: {
  message?: string
  onRetry?: () => void
}) {
  return (
    <div role="alert" className="p-4 text-sm">
      <p className="text-red-700">{message}</p>
      {onRetry !== undefined ? (
        <button type="button" onClick={onRetry} className="mt-2 underline">
          Retry
        </button>
      ) : null}
    </div>
  )
}
