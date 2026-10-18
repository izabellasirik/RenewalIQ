import { RefreshCw } from 'lucide-react';
import { cn } from '../../utils/cn';

/** The "Renewal" label beside an account's status (switched in the status menu — see AccountStageSelect). */
export function RenewalBadge({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full bg-[#efe7fb] px-2.5 py-1 text-xs font-medium leading-none text-[#6a3fb5]', className)} data-testid="renewal-label">
      <RefreshCw size={11} aria-hidden /> Renewal
    </span>
  );
}
