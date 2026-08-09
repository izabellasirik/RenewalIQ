import type { Verdict } from '../../types';
import { VERDICT_LABELS } from '../../types';
import { Badge, type BadgeTone } from './Badge';

const toneByVerdict: Record<Verdict, BadgeTone> = {
  likely_match: 'success',
  possible_match: 'info',
  needs_more_information: 'warning',
  not_eligible: 'danger',
};

export function VerdictBadge({ verdict, className }: { verdict: Verdict; className?: string }) {
  return (
    <Badge tone={toneByVerdict[verdict]} dot className={className}>
      {VERDICT_LABELS[verdict]}
    </Badge>
  );
}
