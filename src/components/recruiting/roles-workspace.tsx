"use client";

import { AppShell } from "@/components/shell/AppShell";
import type { PageData } from "@/lib/types";
import { RolesPage } from "./roles";

// Client -> Roles is a frequent recruiting entry point. Keep it independent
// from campaign and lead-management code so opening a client stays quick.
export function RolesWorkspace({ data }: { data: PageData }) {
  if (!data.client) return null;
  return (
    <AppShell data={data}>
      <RolesPage client={data.client} roles={data.roles ?? []} />
    </AppShell>
  );
}
