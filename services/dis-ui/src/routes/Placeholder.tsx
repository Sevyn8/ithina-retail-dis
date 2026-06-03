import { EmptyState } from '../components/states/EmptyState'

// Placeholder for Phase-1 screens that land in later checkpoints. Renders the
// reusable EmptyState (per the slice plan: later screens render a placeholder on
// the Empty state) so no screen rolls its own state.
export function Placeholder({ title }: { title: string }) {
  return <EmptyState title={title} message="This screen lands in a later checkpoint." />
}
