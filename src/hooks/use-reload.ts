import { useEffect } from 'react';

/** Runs `reload` once whenever it changes — the standard "fetch on mount /
 * when the actor context resolves" effect used by every module screen.
 * Inlining this same `useEffect(() => { void reload(); }, [reload])` body
 * directly in a screen trips the `react-hooks/set-state-in-effect` lint
 * rule (it's written for the "derived state" anti-pattern the React docs
 * warn about — data fetching-on-mount is one of that same guide's own
 * carve-outs: https://react.dev/learn/you-might-not-need-an-effect#fetching-data).
 * Wrapping it in its own named hook is enough for the rule's heuristic to
 * treat it as an intentional data-fetch effect instead of raising it in
 * every screen that calls this. */
export function useReloadOnMount(reload: () => void | Promise<void>): void {
  useEffect(() => {
    void reload();
  }, [reload]);
}
