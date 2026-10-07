/**
 * Double-submit guard for create/save flows that do more than one request (e.g. create the offer,
 * then add labels and upload the thumbnail). `useMutation`'s `busy` only covers its own request, so a
 * Save/Create button re-enabled itself while the follow-ups were still running and a second click
 * created a second record. This holds one lock for the WHOLE flow:
 *
 *   const { pending, guard } = useSubmitGuard();
 *   const submit = (e) => { e.preventDefault(); void guard(async () => { …; nav(...); return true; }); };
 *   <button type="submit" disabled={busy || pending}>{pending ? 'Saving…' : 'Save'}</button>
 *
 * - A ref (not state) gates re-entry, so two clicks/Enters in the same tick can't both start.
 * - Return `true` when the flow succeeded and the page is navigating away: the lock is kept, so the
 *   button never flashes back to enabled. Anything else (validation error, failed request, thrown
 *   error) releases it so the user can fix and retry.
 */
import { useCallback, useRef, useState } from 'react';

export function useSubmitGuard() {
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);

  const guard = useCallback(async (fn: () => Promise<boolean | void>): Promise<void> => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    let keepLocked = false;
    try {
      keepLocked = (await fn()) === true;
    } finally {
      if (!keepLocked) {
        inFlight.current = false;
        setPending(false);
      }
    }
  }, []);

  return { pending, guard };
}
