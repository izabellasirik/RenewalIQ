import { Card, CardBody, Skeleton } from '../ui';

export function MarketCardSkeleton() {
  return (
    <Card>
      <CardBody className="flex flex-col gap-3 pt-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 space-y-2">
            <Skeleton width="70%" />
            <Skeleton width="40%" />
          </div>
          <Skeleton variant="circle" width="52px" className="h-[52px]" />
        </div>
        <Skeleton width="90%" />
        <Skeleton width="60%" />
        <div className="mt-2 border-t border-[var(--color-ink-100)] pt-3">
          <Skeleton width="50%" />
        </div>
      </CardBody>
    </Card>
  );
}
