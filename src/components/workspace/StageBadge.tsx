import type { AccountStage } from '../../types';
import { ACCOUNT_STAGE_LABELS } from '../../types';
import { cn } from '../../utils/cn';

/** One color per status — used everywhere a client status is shown (Accounts list, Workspace, filters). */
const STAGE_STYLE: Record<AccountStage, { chip: string; dot: string }> = {
  new: { chip: 'bg-[var(--color-ink-100)] text-[var(--color-ink-600)]', dot: 'bg-[var(--color-ink-300)]' }, // light gray
  collecting_info: { chip: 'bg-[var(--color-warning-100)] text-[var(--color-warning-600)]', dot: 'bg-[var(--color-warning-500)]' }, // amber
  ready_to_submit: { chip: 'bg-[var(--color-accent-100)] text-[var(--color-accent-600)]', dot: 'bg-[var(--color-accent-500)]' }, // teal
  submitted: { chip: 'bg-[var(--color-info-100)] text-[var(--color-info-600)]', dot: 'bg-[var(--color-info-500)]' }, // blue
  quoted: { chip: 'bg-[var(--color-success-100)] text-[var(--color-success-600)]', dot: 'bg-[var(--color-success-500)]' }, // green
  bound: { chip: 'bg-[var(--color-success-600)] text-white', dot: 'bg-white/80' }, // darker green
  on_hold: { chip: 'bg-[#e4eaf2] text-[#4f6485]', dot: 'bg-[#8095b3]' }, // muted gray-blue
  lost: { chip: 'border border-[var(--color-ink-200)] bg-[var(--color-ink-50)] text-[var(--color-ink-400)]', dot: 'bg-[var(--color-ink-300)]' }, // muted gray
};

export function StageBadge({ stage, className, title }: { stage: AccountStage; className?: string; title?: string }) {
  const style = STAGE_STYLE[stage];
  return (
    <span title={title} className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium leading-none', style.chip, className)}>
      <span className={cn('h-1.5 w-1.5 rounded-full', style.dot)} />
      {ACCOUNT_STAGE_LABELS[stage]}
    </span>
  );
}
