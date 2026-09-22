import { cn } from '../../utils/cn';

/**
 * Official RenewalIQ mark — asset lives at public/brand/logo-mark.png (the exact final logo file
 * provided, trimmed to its content and given a transparent background; not a redraw). This is the
 * single place that references that file, so replacing the asset only requires editing here.
 *
 * Sized by height only (width auto) so the mark's real aspect ratio is preserved at any size —
 * never stretched into a forced square.
 */
function LogoMark({ size }: { size: number }) {
  return (
    <img
      src="/brand/logo-mark.png"
      alt=""
      aria-hidden="true"
      className="block w-auto shrink-0 object-contain"
      style={{ height: size }}
    />
  );
}

export function BrandLogo({
  size = 32,
  wordmark = true,
  className,
}: {
  /** Pixel height of the icon mark (width follows automatically to keep its aspect ratio). */
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
