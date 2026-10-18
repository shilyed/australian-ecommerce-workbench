import { trpc } from "@/providers/trpc";

export function useWorkspace() {
  const query = trpc.workbench.workspace.useQuery(undefined, {
    staleTime: 15_000,
    refetchOnWindowFocus: true,
  });
  const utils = trpc.useUtils();
  const refresh = async () => {
    await Promise.all([utils.workbench.workspace.invalidate(), utils.workbench.dashboard.invalidate()]);
  };
  return { ...query, refresh };
}
