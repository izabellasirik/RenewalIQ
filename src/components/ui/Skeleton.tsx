import { cn } from '../../utils/cn';

interface SkeletonProps {
  variant?: 'text' | 'block' | 'circle';
  width?: string;
  className?: string;
}

export function Skeleton({ variant = 'text', width, className }: SkeletonProps) {
  return (
    <span
      className={cn(
        'inline-block animate-pulse bg-[var(--color-ink-100)]',
        variant === 'text' && 'h-3.5 rounded',
        variant === 'block' && 'rounded-lg',
        variant === 'circle' && 'rounded-full',
        className
      )}
      style={{ width: width ?? (variant === 'text' ? '70%' : undefined) }}
    />
  );
}
