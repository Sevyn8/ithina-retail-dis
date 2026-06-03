import { Link } from 'react-router'

import { useAuth } from '../auth/useAuth'
import { useUnreadCount } from '../lib/dis-ui-server/notifications'

// Header bell (demand list 6.1). A link to /notifications showing the unread
// count. The aria-label encodes the count and is distinct from the sidebar's
// "Notifications" nav link, so each is addressable on its own.
export function NotificationBell() {
  const { snapshot } = useAuth()
  const { data } = useUnreadCount(snapshot)
  const unread = data?.unread ?? 0

  return (
    <Link to="/notifications" aria-label={`Notifications, ${unread} unread`} className="text-sm">
      Alerts{unread > 0 ? ` (${unread})` : ''}
    </Link>
  )
}
