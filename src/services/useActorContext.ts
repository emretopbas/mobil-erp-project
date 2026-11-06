// Bridges SessionProvider (React state) to the plain `ActorContext` every
// guarded service method expects. Returns null whenever the session isn't
// `ready` — screens that call services should treat a null context as "not
// mounted yet", the same way they'd treat any other not-ready session state.

import { useMemo } from 'react';

import { useSession } from './SessionProvider';
import type { ActorContext } from './context';

export function useActorContext(): ActorContext | null {
  const { status, employee, business, repository } = useSession();
  return useMemo(() => {
    if (status !== 'ready' || !employee || !business || !repository) return null;
    return { employee, business, repository };
  }, [status, employee, business, repository]);
}
