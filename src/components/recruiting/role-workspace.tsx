"use client";

import { AppShell } from "@/components/shell/AppShell";
import type { PageData } from "@/lib/types";
import { RolePipeline } from "./role-pipeline";

// The recruiting workspace has its own client entry point. This keeps the
// large campaign and lead-management workspace out of every role page bundle.
export function RoleWorkspace({ data }: { data: PageData }) {
  if (!data.client || !data.role) return null;
  return (
    <AppShell data={data}>
      <RolePipeline
        client={data.client}
        role={data.role}
        workQueue={
          data.roleDashboardCounts?.find((item) => item.role_id === data.role?.id)
        }
        roleCandidates={data.roleCandidates ?? []}
        counts={data.roleCandidateCounts ?? {}}
        masterCandidates={data.masterCandidates ?? []}
        masterRoleCandidateIds={data.masterRoleCandidateIds ?? []}
        total={data.total ?? 0}
        page={data.page ?? 1}
        sourcingProspects={data.sourcingProspects ?? []}
        roleFields={data.roleFields ?? []}
        shareLinks={data.shareLinks ?? []}
        stageFunnel={data.roleStageFunnel ?? []}
        stageDurations={data.roleStageDurations ?? []}
        sourcePerformance={data.roleSourcePerformance ?? []}
      />
    </AppShell>
  );
}
