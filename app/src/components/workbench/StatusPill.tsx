import { cn } from "@/lib/utils";
import { label } from "@/lib/format";

type Tone = "neutral" | "success" | "warning" | "danger" | "info";

const toneByValue: Record<string, Tone> = {
  critical: "danger",
  failed: "danger",
  platform_failed: "danger",
  auth_invalid: "danger",
  expired: "danger",
  revoked: "danger",
  shortage: "danger",
  rejected: "danger",
  matching: "warning",
  high: "warning",
  pending: "warning",
  incomplete: "warning",
  waiting_external: "warning",
  pending_inspection: "warning",
  pending_decision: "warning",
  out_of_scope: "warning",
  estimated: "info",
  assess: "info",
  queued: "info",
  running: "info",
  retrying: "info",
  platform_pending: "info",
  ready: "info",
  publishing: "warning",
  sample_evaluation: "info",
  adopted: "success",
  published: "success",
  paid: "success",
  approved: "success",
  verified: "success",
  confirmed: "success",
  fulfilled: "success",
  full: "success",
  platform_confirmed: "success",
  authorized: "success",
  reconciled: "success",
  succeeded: "success",
};

export function StatusPill({
  value,
  className,
  text,
}: {
  value: string | null | undefined;
  className?: string;
  text?: string;
}) {
  return (
    <span
      data-status={value ?? "unknown"}
      data-tone={toneByValue[value ?? ""] ?? "neutral"}
      className={cn("workbench-status", className)}
    >
      <span className="status-dot bg-current" aria-hidden />
      {text ?? label(value)}
    </span>
  );
}
