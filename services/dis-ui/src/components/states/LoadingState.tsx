// Reusable loading state (surface map 6.4). Screens use this; they do not roll
// their own. Surface Map is not in the repo, so the exact visual is provisional.
export function LoadingState({ label = 'Loading...' }: { label?: string }) {
  return (
    <p role="status" className="p-4 text-sm text-gray-500">
      {label}
    </p>
  )
}
