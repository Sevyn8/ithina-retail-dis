import type { ReactNode } from 'react'

// Reusable empty state (surface map 6.4). Also backs the placeholder screens and
// the not-found route this checkpoint. Surface Map is not in the repo, so the
// exact visual is provisional.
export function EmptyState({
  title,
  message,
  children,
}: {
  title: string
  message?: string
  children?: ReactNode
}) {
  return (
    <section className="p-6 text-center">
      <h1 className="text-lg font-semibold">{title}</h1>
      {message !== undefined ? <p className="mt-2 text-sm text-gray-500">{message}</p> : null}
      {children}
    </section>
  )
}
