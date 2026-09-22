import type { AccountStage } from '../../types';
import type { BadgeTone } from '../ui';

export const ACCOUNT_STAGE_TONE: Record<AccountStage, BadgeTone> = {
  new: 'neutral',
  collecting_info: 'warning',
  ready_to_submit: 'brand',
  submitted: 'info',
  quoted: 'success',
  bound: 'success',
  on_hold: 'neutral',
  lost: 'danger',
};
