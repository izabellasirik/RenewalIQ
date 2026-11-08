import { RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { useAccountsStore } from '../../state/useAccountsStore';
import { Button } from '../ui';

/** The agency's markets didn't load (database busy, network): say so, instead of a short list that looks like markets were deleted. */
export function AgencyMarketsNotice() {
  const failed = useAccountsStore((s) => s.agencyCarriersFailed && !!s.agencyAccess);
  const reload = useAccountsStore((s) => s.reloadCarrierAppetite);
  const [busy, setBusy] = useState(false);
  if (!failed) return null;
  return (
    <div data-testid="agency-markets-failed" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <span>Couldn’t load your agency’s markets just now — the list may be incomplete. Trying again…</span>
      <Button size="sm" variant="secondary" icon={<RefreshCw size={14} />} disabled={busy} onClick={async () => { setBusy(true); await reload(); setBusy(false); }}>
        Retry now
      </Button>
    </div>
  );
}
