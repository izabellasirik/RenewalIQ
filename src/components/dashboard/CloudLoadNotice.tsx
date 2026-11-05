import { Loader2, RefreshCw } from 'lucide-react';
import { useAccountsStore } from '../../state/useAccountsStore';
import { Button } from '../ui';

/** While the signed-in user's accounts load (or after a load failed): say so, instead of an empty page. */
export function CloudLoadNotice() {
  const cloudLoad = useAccountsStore((s) => s.cloudLoad);
  const signedIn = useAccountsStore((s) => !!s.currentUserId);
  const loaded = useAccountsStore((s) => !!s.currentUserId && s.cloudHydratedFor === s.currentUserId);
  const retry = useAccountsStore((s) => s.hydrateCloudSubmissions);
  if (!signedIn) return null;
  if (cloudLoad === 'failed') {
    return (
      <div data-testid="cloud-load-failed" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <span>Couldn’t load your accounts. Trying again…</span>
        <Button size="sm" variant="secondary" icon={<RefreshCw size={14} />} onClick={() => void retry()}>
          Retry now
        </Button>
      </div>
    );
  }
  if (cloudLoad === 'loading' && !loaded) {
    return (
      <div data-testid="cloud-loading" className="mb-4 flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
        <Loader2 size={16} className="animate-spin" />
        Loading your accounts…
      </div>
    );
  }
  return null;
}
