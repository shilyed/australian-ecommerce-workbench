import { cn } from "@/lib/utils";
import { label } from "@/lib/format";

const toneByValue: Record<string, string> = {
  critical: "text-red-300 bg-red-500/10 border-red-400/30",
  failed: "text-red-300 bg-red-500/10 border-red-400/30",
  platform_failed: "text-red-300 bg-red-500/10 border-red-400/30",
  auth_invalid: "text-red-300 bg-red-500/10 border-red-400/30",
  expired: "text-red-300 bg-red-500/10 border-red-400/30",
  revoked: "text-red-300 bg-red-500/10 border-red-400/30",
  shortage: "text-red-300 bg-red-500/10 border-red-400/30",
  matching: "text-amber-300 bg-amber-400/10 border-amber-300/30",
  high: "text-amber-300 bg-amber-400/10 border-amber-300/30",
  pending: "text-amber-300 bg-amber-400/10 border-amber-300/30",
  incomplete: "text-amber-300 bg-amber-400/10 border-amber-300/30",
  waiting_external: "text-amber-300 bg-amber-400/10 border-amber-300/30",
  pending_inspection: "text-amber-300 bg-amber-400/10 border-amber-300/30",
  estimated: "text-cyan-200 bg-cyan-400/10 border-cyan-300/30",
  assess: "text-cyan-200 bg-cyan-400/10 border-cyan-300/30",
  queued: "text-cyan-200 bg-cyan-400/10 border-cyan-300/30",
  retrying: "text-cyan-200 bg-cyan-400/10 border-cyan-300/30",
  platform_pending: "text-cyan-200 bg-cyan-400/10 border-cyan-300/30",
  ready: "text-cyan-200 bg-cyan-400/10 border-cyan-300/30",
  publishing: "text-amber-300 bg-amber-400/10 border-amber-300/30",
  unpublished: "text-slate-300 bg-slate-400/10 border-slate-300/20",
  published: "text-emerald-300 bg-emerald-400/10 border-emerald-300/30",
  paid: "text-emerald-300 bg-emerald-400/10 border-emerald-300/30",
  approved: "text-emerald-300 bg-emerald-400/10 border-emerald-300/30",
  verified: "text-emerald-300 bg-emerald-400/10 border-emerald-300/30",
  confirmed: "text-emerald-300 bg-emerald-400/10 border-emerald-300/30",
  fulfilled: "text-emerald-300 bg-emerald-400/10 border-emerald-300/30",
  full: "text-emerald-300 bg-emerald-400/10 border-emerald-300/30",
  platform_confirmed: "text-emerald-300 bg-emerald-400/10 border-emerald-300/30",
  authorized: "text-emerald-300 bg-emerald-400/10 border-emerald-300/30",
  reconciled: "text-emerald-300 bg-emerald-400/10 border-emerald-300/30",
  succeeded: "text-emerald-300 bg-emerald-400/10 border-emerald-300/30",
  out_of_scope: "text-fuchsia-200 bg-fuchsia-400/10 border-fuchsia-300/30",
};

export function StatusPill({ value, className }: { value: string | null | undefined; className?: string }) {
  const tone = toneByValue[value ?? ""] ?? "text-slate-300 bg-slate-400/10 border-slate-300/20";
  return (
    <span className={cn("inline-flex min-h-7 items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-medium", tone, className)}>
      <span className="status-dot bg-current" aria-hidden />
      {label(value)}
    </span>
  );
}
