import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '../../utils/cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
}

const variantClasses: Record<Variant, string> = {
  primary: 'bg-[var(--color-brand-800)] text-white hover:bg-[var(--color-brand-700)] shadow-sm',
  secondary: 'bg-white text-[var(--color-ink-800)] border border-[var(--color-ink-200)] hover:border-[var(--color-ink-300)] hover:bg-[var(--color-ink-50)]',
  ghost: 'bg-transparent text-[var(--color-ink-600)] hover:bg-[var(--color-ink-100)]',
  danger: 'bg-white text-[var(--color-danger-600)] border border-[var(--color-danger-100)] hover:bg-[var(--color-danger-100)]',
};

const sizeClasses: Record<Size, string> = {
  sm: 'text-xs px-2.5 py-1.5 gap-1.5',
  md: 'text-sm px-4 py-2.5 gap-2',
};

export function Button({ variant = 'primary', size = 'md', icon, className, children, ...rest }: ButtonProps) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center rounded-lg font-medium transition-colors duration-150 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer',
        variantClasses[variant],
        sizeClasses[size],
        className
      )}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}
