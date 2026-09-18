"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Briefcase,
  CalendarClock,
  ChevronDown,
  Crosshair,
  FolderOpen,
  LogOut,
  Settings,
  Users,
} from "lucide-react";
import type { PageData } from "@/lib/types";

function itemClass(view: string, views: string[]) {
  return `shell-link${views.includes(view) ? " active" : ""}`;
}

export function Sidebar({ data }: { data: PageData }) {
  const router = useRouter();
  const client = data.client ?? null;
  const navigationClients = data.navigationClients ?? data.clients;
  const view = data.view;
  return (
    <aside className="shell-sidebar">
      <div className="shell-top">
        <Link href="/clients" className="shell-brand" aria-label="LeadScope home">
          <span className="shell-mark" aria-hidden="true">
            <Crosshair size={17} />
          </span>
          <span className="shell-name">LeadScope</span>
          <span className="beta">Beta</span>
        </Link>
        <label className="shell-switcher">
          <FolderOpen size={16} aria-hidden="true" />
          <select
            aria-label="Switch client"
            value={client?.id ?? ""}
            onChange={(e) =>
              router.push(
                e.target.value ? `/clients/${e.target.value}` : "/clients",
              )
            }
          >
            <option value="">All clients</option>
            {navigationClients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.archived ? " (archived)" : ""}
              </option>
            ))}
          </select>
          <ChevronDown size={14} aria-hidden="true" />
        </label>
      </div>
      <nav className="shell-nav" aria-label="Primary">
        <div className="shell-group">
          <span className="shell-label">Workspace</span>
          <Link className={itemClass(view, ["clients"])} href="/clients">
            <Users size={17} aria-hidden="true" />
            Clients
          </Link>
          <Link className="shell-link" href="/clients#today">
            <CalendarClock size={17} aria-hidden="true" />
            Today
          </Link>
          {client && (
            <Link
              className={itemClass(view, ["roles", "role"])}
              href={`/clients/${client.id}/roles`}
            >
              <Briefcase size={17} aria-hidden="true" />
              Roles
            </Link>
          )}
        </div>
      </nav>
      <div className="shell-footer">
        {client && (
          <Link
            className={itemClass(view, ["settings"])}
            href={`/settings?client=${client.id}`}
          >
            <Settings size={17} aria-hidden="true" />
            Settings
          </Link>
        )}
        <div className="shell-user">
          <span className="avatar" aria-hidden="true">
            {data.email[0].toUpperCase()}
          </span>
          <span className="shell-user-meta">
            <strong>Agency operator</strong>
            <small title={data.email}>{data.email}</small>
          </span>
          <form action="/auth/logout" method="post">
            <button
              className="shell-icon-btn"
              aria-label="Sign out"
              title="Sign out"
            >
              <LogOut size={16} />
            </button>
          </form>
        </div>
      </div>
    </aside>
  );
}
