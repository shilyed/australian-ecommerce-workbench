import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";

export function LoadingPanel() {
  return (
    <div className="grid gap-3">
      {Array.from({ length: 5 }).map((_, index) => (
        <Skeleton key={index} className="h-20 rounded-2xl bg-secondary/80" />
      ))}
    </div>
  );
}

export function EmptyPanel({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <div className="flex min-h-48 flex-col items-center justify-center rounded-2xl border border-dashed bg-secondary/25 p-8 text-center">
      <p className="text-base font-medium text-foreground">{title}</p>
      <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">{description}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
