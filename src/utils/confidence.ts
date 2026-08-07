import type { Confidence } from '../types';

export const CONFIDENCE_LABELS: Record<Confidence, string> = {
  high: 'High confidence',
  medium: 'Medium confidence',
  low: 'Low confidence',
  manual: 'Broker entered',
};

export const CONFIDENCE_ORDER: Record<Confidence, number> = {
  manual: 0,
  high: 1,
  medium: 2,
  low: 3,
};
