import { AlertCircle, Building2, CalendarClock, CalendarDays, Mail, Send, UserRound } from 'lucide-react';
import type { ActionItem, ActionKind } from '../../services/workflow/nextActions';

export const ACTION_KIND_META: Record<ActionKind, { label: string; icon: typeof Mail; color: string }> = {
  ready_to_send: { label: 'Ready to send', icon: Send, color: 'text-[var(--color-accent-600)] bg-[var(--color-accent-100)]' },
  action_required: { label: 'Action required', icon: AlertCircle, color: 'text-[var(--color-danger-600)] bg-[var(--color-danger-100)]' },
  carrier_follow_up: { label: 'Carrier follow-up', icon: Building2, color: 'text-[var(--color-info-600)] bg-[var(--color-info-100)]' },
  follow_up: { label: 'Follow-up', icon: CalendarClock, color: 'text-[var(--color-brand-700)] bg-[var(--color-brand-800)]/8' },
  client_follow_up: { label: 'Client follow-up', icon: UserRound, color: 'text-[var(--color-warning-600)] bg-[var(--color-warning-100)]' },
  renewal: { label: 'Renewal', icon: CalendarDays, color: 'text-[var(--color-brand-700)] bg-[var(--color-brand-800)]/8' },
};

export function workspaceHref(action: ActionItem): string {
  const params = new URLSearchParams({ tab: action.tab });
  if (action.quoteId) params.set('quote', action.quoteId);
  return `/accounts/${action.accountId}?${params.toString()}`;
}
