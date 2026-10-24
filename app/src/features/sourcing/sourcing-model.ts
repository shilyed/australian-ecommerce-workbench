import type { inferRouterInputs } from "@trpc/server";
import type { AppRouter } from "../../../api/router";
import type { useWorkspace } from "@/hooks/useWorkspace";

type Workspace = NonNullable<ReturnType<typeof useWorkspace>["data"]>;
type Inputs = inferRouterInputs<AppRouter>["workbench"];

export type Candidate = Workspace["candidates"][number];
export type Supplier = Workspace["suppliers"][number];
export type SourcingActor = Pick<
  Workspace["currentUser"],
  "role" | "businessRole" | "status"
>;
export type CandidateOperation =
  | { kind: "status"; candidate: Candidate }
  | { kind: "compliance"; candidate: Candidate; platform: "etsy" | "ebay" }
  | { kind: "convert"; candidate: Candidate };

export const candidateStatuses = [
  "candidate",
  "sample_evaluation",
  "pending_decision",
  "adopted",
  "rejected",
  "paused",
] as const;

export function canManageSourcing(user: SourcingActor) {
  return (
    user.status === "active" &&
    (user.role === "admin" ||
      user.businessRole === "admin" ||
      user.businessRole === "operations")
  );
}

export function filterCandidates(
  candidates: readonly Candidate[],
  filters: {
    query: string;
    status: string;
    supplierId: number;
    convertedOnly: boolean;
  }
) {
  const query = filters.query.trim().toLowerCase();
  return candidates.filter(candidate => {
    const text =
      `${candidate.name} ${candidate.spec} ${candidate.sourceUrl} ${candidate.supplier?.name ?? ""}`.toLowerCase();
    return (
      (!query || text.includes(query)) &&
      (filters.status === "all" || candidate.status === filters.status) &&
      (!filters.supplierId || candidate.supplierId === filters.supplierId) &&
      (!filters.convertedOnly || candidate.convertedSkuId !== null)
    );
  });
}

export function sourcingSummary(candidates: readonly Candidate[]) {
  return {
    total: candidates.length,
    evaluating: candidates.filter(item => item.status === "sample_evaluation")
      .length,
    deciding: candidates.filter(item => item.status === "pending_decision")
      .length,
    converted: candidates.filter(item => item.convertedSkuId !== null).length,
    lastChecked: candidates.reduce<Date | null>((latest, item) => {
      const checked = item.complianceCheckedAt;
      return checked && (!latest || checked > latest) ? checked : latest;
    }, null),
  };
}

const field = (form: FormData, name: string) =>
  String(form.get(name) ?? "").trim();

export function supplierInput(form: FormData): Inputs["createSupplier"] {
  return {
    name: field(form, "name"),
    shopUrl: field(form, "shopUrl"),
    contactName: field(form, "contactName"),
    contactInfo: field(form, "contactInfo"),
    notes: field(form, "notes"),
  };
}

export function candidateInput(form: FormData): Inputs["createCandidate"] {
  return {
    name: field(form, "name"),
    sourceUrl: field(form, "sourceUrl"),
    supplierId: Number(field(form, "supplierId")),
    spec: field(form, "spec"),
    quote: field(form, "quote"),
    referencePrice: field(form, "referencePrice") || undefined,
    moq: Number(field(form, "moq")) || undefined,
    leadTimeDays: Number(field(form, "leadTimeDays")) || undefined,
    notes: field(form, "notes"),
  };
}

export function nextCandidateStatus(candidate: Candidate) {
  return candidate.status === "candidate"
    ? "sample_evaluation"
    : "pending_decision";
}

export function statusInput(
  candidate: Candidate,
  form: FormData
): Inputs["updateCandidateStatus"] {
  return {
    id: candidate.id,
    status: nextCandidateStatus(candidate),
    sampleScore: candidate.sampleScore ?? undefined,
    sampleReview: candidate.sampleReview ?? undefined,
    decisionNote: field(form, "decisionNote"),
  };
}

export function complianceInput(
  candidate: Candidate,
  platform: "etsy" | "ebay",
  form: FormData
): Inputs["setCandidateCompliance"] {
  return {
    id: candidate.id,
    platform,
    conclusion: "approved",
    basis: field(form, "basis"),
  };
}

export function conversionInput(
  candidate: Candidate,
  form: FormData
): Inputs["convertCandidate"] {
  return {
    candidateId: candidate.id,
    skuCode: field(form, "skuCode"),
    decisionNote: field(form, "decisionNote"),
  };
}
