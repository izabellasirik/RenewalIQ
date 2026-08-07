import { Sparkles, CircleCheck, CircleAlert, CircleHelp } from 'lucide-react';
import type { Confidence } from '../../types';
import { CONFIDENCE_LABELS } from '../../utils/confidence';
import { Badge, type BadgeTone } from './Badge';

const toneByConfidence: Record<Confidence, BadgeTone> = {
  manual: 'brand',
  high: 'success',
  medium: 'warning',
  low: 'danger',
};

const iconByConfidence: Record<Confidence, typeof CircleCheck> = {
  manual: Sparkles,
  high: CircleCheck,
  medium: CircleAlert,
  low: CircleHelp,
};

export function ConfidenceBadge({ confidence, className }: { confidence: Confidence; className?: string }) {
  const Icon = iconByConfidence[confidence];
  return (
    <Badge tone={toneByConfidence[confidence]} className={className}>
      <Icon size={12} strokeWidth={2.5} />
      {CONFIDENCE_LABELS[confidence]}
    </Badge>
  );
}
