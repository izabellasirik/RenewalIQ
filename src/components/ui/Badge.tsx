import type { HTMLAttributes } from 'react';
import { cn } from '../../utils/cn';

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'brand';

const toneClasses: Record<BadgeTone, string> = {
  neutral: 'bg-[var(--color-ink-100)] text-[var(--color-ink-600)]',
  success: 'bg-[var(--color-success-100)] text-[var(--color-success-600)]',
  warning: 'bg-[var(--color-warning-100)] text-[var(--color-warning-600)]',
  danger: 'bg-[var(--color-danger-100)] text-[var(--color-danger-600)]',
  info: 'bg-[var(--color-info-100)] text-[var(--color-info-600)]',
  brand: 'bg-[var(--color-accent-100)] text-[var(--color-accent-600)]',
};

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  dot?: boolean;
}

export function Badge({ tone = 'neutral', dot, className, children, ...rest }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium leading-none',
        toneClasses[tone],
        className
      )}
      {...rest}
    >
      {dot && <span className={cn('h-1.5 w-1.5 rounded-full', toneDotClasses[tone])} />}
      {children}
    </span>
  );
}

const toneDotClasses: Record<BadgeTone, string> = {
  neutral: 'bg-[var(--color-ink-400)]',
  success: 'bg-[var(--color-success-500)]',
  warning: 'bg-[var(--color-warning-500)]',
  danger: 'bg-[var(--color-danger-500)]',
  info: 'bg-[var(--color-info-500)]',
  brand: 'bg-[var(--color-accent-500)]',
};
