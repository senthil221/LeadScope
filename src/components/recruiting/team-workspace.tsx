"use client";

import { AppShell } from "@/components/shell/AppShell";
import type { PageData } from "@/lib/types";
import { TeamPage } from "./team";

export function TeamWorkspace({ data }: { data: PageData }) {
  return (
    <AppShell data={data}>
      <TeamPage operators={data.operators ?? []} currentEmail={data.email} />
    </AppShell>
  );
}
