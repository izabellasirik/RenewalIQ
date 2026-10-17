import type { QuoteStatus } from '../../types';
import type { BadgeTone } from '../ui';

export const QUOTE_STATUS_TONE: Record<QuoteStatus, BadgeTone> = {
  preparing: 'neutral',
  submitted: 'info',
  waiting_on_carrier: 'info',
  additional_info_requested: 'warning',
  quoted: 'success',
  declined: 'danger',
  bound: 'brand',
};
