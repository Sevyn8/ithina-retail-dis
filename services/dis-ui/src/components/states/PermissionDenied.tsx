// Reusable permission-denied state (surface map 6.4). Built now for reuse, but
// NOT wired to any route this checkpoint: there are no ops/cross-tenant routes yet
// (FM3 gates on isOps only, and no ops surface exists). It lands on a route when
// the first ops surface ships. Surface Map is not in the repo; visual provisional.
export function PermissionDenied({
  message = 'You do not have access to this area.',
}: {
  message?: string
}) {
  return (
    <div role="alert" className="p-6 text-center text-sm">
      <h1 className="text-lg font-semibold">Access denied</h1>
      <p className="mt-2 text-gray-500">{message}</p>
    </div>
  )
}
