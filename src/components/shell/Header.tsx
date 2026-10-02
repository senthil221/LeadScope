"use client";
import Link from "next/link";
import type { PageData } from "@/lib/types";

export function ShellHeader({ data }: { data: PageData }) {
  const client = data.client ?? null;
  const workspaceTitle: Record<string, string> = {
    clients: "Clients", "all-roles": "Roles", "master-db": "Master Database",
    blocklist: "Blocklist", team: "Access", settings: "Settings",
  };
  return (
    <div className="shell-header">
      <nav className="shell-crumbs" aria-label="Breadcrumb">
        {client ? (
          <>
            <Link href="/clients">Clients</Link>
            <span className="slash" aria-hidden="true">
              /
            </span>
            <span aria-current="page">{client.name}</span>
          </>
        ) : (
          <><span>Workspace</span><span className="slash" aria-hidden="true">/</span><span aria-current="page">{workspaceTitle[data.view] ?? "Recruiting"}</span></>
        )}
      </nav>
      <span className="shell-workspace-label">Recruiting CRM</span>
    </div>
  );
}
