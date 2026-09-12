import { cn } from '../../utils/cn';

/**
 * Official RenewalIQ mark — asset lives at public/brand/logo-mark.svg. This is the single place
 * that references that file, so replacing the asset (or its path) only requires editing this file.
 */
function LogoMark({ size }: { size: number }) {
  return (
    <img
      src="/brand/logo-mark.svg"
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      className="shrink-0 object-contain"
      style={{ width: size, height: size }}
    />
  );
}

export function BrandLogo({
  size = 32,
  wordmark = true,
  className,
}: {
  /** Pixel size of the icon mark. */
  size?: number;
  /** Whether to render the "RenewalIQ" wordmark next to the mark. */
  wordmark?: boolean;
  className?: string;
}) {
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <LogoMark size={size} />
      {wordmark && (
        <span className="text-sm font-semibold tracking-tight">
          <span className="text-[var(--color-ink-900)]">Renewal</span>
          <span className="text-[var(--color-brand-600)]">IQ</span>
        </span>
      )}
    </div>
  );
}
