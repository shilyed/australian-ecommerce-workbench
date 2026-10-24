import type { ReactNode } from "react";

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="workbench-page-header mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0 max-w-4xl">
        <p className="ops-label mb-2">{eyebrow}</p>
        <h1 className="text-[28px] font-bold leading-9 text-foreground">
          {title}
        </h1>
        {description && (
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}
