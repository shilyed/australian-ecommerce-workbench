import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";

export function LoadingPanel() {
  return (
    <div role="status" aria-label="正在读取工作台数据" className="space-y-6">
      <span className="sr-only">正在读取数据，请稍候</span>
      <Skeleton className="h-8 w-48 rounded-none bg-secondary" />
      <div className="grid grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, index) => (
          <Skeleton key={index} className="h-24 rounded-none bg-secondary" />
        ))}
      </div>
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-14 rounded-none bg-secondary" />
        ))}
      </div>
    </div>
  );
}

export function EmptyPanel({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div
      data-slot="workbench-empty"
      className="flex min-h-40 flex-col items-center justify-center bg-secondary/35 px-6 py-8 text-center"
    >
      <p className="text-base font-semibold text-foreground">{title}</p>
      {description && (
        <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
          {description}
        </p>
      )}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
