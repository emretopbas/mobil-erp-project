import { QueueApp } from '@/features/queue-erp/QueueApp';
import { useActorContext } from '@/services';

/** The authenticated home. Only reachable once `status === 'ready'` (see
 * ../_layout.tsx's AuthGate) — `useActorContext()` returning null here would
 * mean that gate let something through it shouldn't have, so rendering
 * nothing in that case is the correct defensive fallback, not a real path. */
export default function Index() {
  const ctx = useActorContext();
  if (!ctx) return null;
  return <QueueApp ctx={ctx} />;
}
