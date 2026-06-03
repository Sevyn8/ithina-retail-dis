import { useState } from 'react'

import { useAuth } from '../auth/useAuth'
import { EmptyState } from '../components/states/EmptyState'
import { ErrorState } from '../components/states/ErrorState'
import { LoadingState } from '../components/states/LoadingState'
import {
  useMarkAllRead,
  useMarkRead,
  useNotifications,
} from '../lib/dis-ui-server/notifications'
import type { NotificationFilter, Severity } from '../lib/dis-ui-server/notifications'

const FILTERS: { value: NotificationFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'unread', label: 'Unread' },
  { value: 'errors', label: 'Errors' },
]

function severityClass(severity: Severity): string {
  if (severity === 'error') {
    return 'text-red-700'
  }
  if (severity === 'warning') {
    return 'text-yellow-700'
  }
  return 'text-gray-600'
}

// Notifications (surface map screen 9), TENANT slice. List (demand list 6.2) with
// a filter; per-row mark-read (6.3) and mark-all-read (6.4). The header bell reads
// the unread count (6.1); the mutations invalidate the shared query prefix so the
// bell updates. Read-only otherwise (the `link` field is not wired this checkpoint).
export function Notifications() {
  const { snapshot } = useAuth()
  const [filter, setFilter] = useState<NotificationFilter>('all')
  const list = useNotifications(snapshot, filter)
  const markRead = useMarkRead(snapshot)
  const markAllRead = useMarkAllRead(snapshot)

  return (
    <section>
      <h1 className="text-xl font-semibold">Notifications</h1>

      <div className="mt-3 flex items-center gap-2 text-sm">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setFilter(f.value)}
            className={`rounded border px-2 py-1 ${filter === f.value ? 'bg-gray-200 font-semibold' : ''}`}
          >
            {f.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => markAllRead.mutate()}
          className="ml-auto rounded border px-2 py-1"
        >
          Mark all read
        </button>
      </div>

      <div className="mt-4">{renderBody()}</div>
    </section>
  )

  function renderBody() {
    if (list.isPending) {
      return <LoadingState label="Loading notifications..." />
    }
    if (list.isError) {
      return <ErrorState message="Could not load notifications." onRetry={() => void list.refetch()} />
    }
    if (list.data.length === 0) {
      return <EmptyState title="No notifications" message="Nothing to show for this filter." />
    }
    return (
      <ul className="flex flex-col gap-2 text-sm">
        {list.data.map((n) => (
          <li key={n.id} className={`rounded border p-2 ${n.read ? '' : 'font-semibold'}`}>
            <div className="flex items-center justify-between">
              <span>
                <span className={severityClass(n.severity)}>[{n.severity}]</span> {n.text}
              </span>
              {n.read ? (
                <span className="text-xs text-gray-400">read</span>
              ) : (
                <button
                  type="button"
                  onClick={() => markRead.mutate(n.id)}
                  className="text-xs underline"
                >
                  Mark read
                </button>
              )}
            </div>
            <div className="mt-1 text-xs text-gray-500">
              {n.source} · {n.at}
            </div>
          </li>
        ))}
      </ul>
    )
  }
}
