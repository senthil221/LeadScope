"use client";
import Link from "next/link";
import Image from "next/image";
import { ListTodo, Database, Briefcase, LogOut, Settings, ShieldCheck, Users } from "lucide-react";
import type { PageData } from "@/lib/types";
import logo from "@/assets/brand/leadvance-recruiting.png";
import { ClientSwitcher } from "./ClientSwitcher";

function itemClass(view: string, views: string[]) {
  return `shell-link${views.includes(view) ? " active" : ""}`;
}

export function Sidebar({ data }: { data: PageData }) {
  const client = data.client ?? null;
  const navigationClients = data.navigationClients ?? data.clients;
  const view = data.view;
  return (
    <aside className="shell-sidebar">
      <div className="shell-top">
        <Link href="/clients" className="shell-brand" aria-label="Leadvance Recruiting home">
          {/* unoptimized: a fixed-size logo gains nothing from the image
              optimizer, and the standalone runtime does not have to carry it. */}
          <Image
            src={logo}
            alt="Leadvance Recruiting"
            className="shell-logo"
            priority
            unoptimized
          />
        </Link>
        <ClientSwitcher clients={navigationClients} currentId={client?.id ?? null} />
      </div>
      <nav className="shell-nav" aria-label="Primary">
        <div className="shell-group">
          <span className="shell-label">Workspace</span>
          <Link className={itemClass(view, ["work"])} aria-current={view === "work" ? "page" : undefined} href="/work"><ListTodo size={17} aria-hidden="true" />Work queue</Link>
          <Link className={itemClass(view, ["clients"])} aria-current={view === "clients" ? "page" : undefined} href="/clients">
            <Users size={17} aria-hidden="true" />
            Clients
          </Link>
          <Link className={itemClass(view, ["master-db"])} aria-current={view === "master-db" ? "page" : undefined} href="/master-db"><Database size={17} aria-hidden="true" />Master Database</Link>
          <Link className={itemClass(view, ["all-roles", "roles", "role"])} aria-current={["all-roles", "roles", "role"].includes(view) ? "page" : undefined} href="/roles"><Briefcase size={17} aria-hidden="true" />Roles</Link>
          <Link className={itemClass(view, ["blocklist"])} aria-current={view === "blocklist" ? "page" : undefined} href="/blocklist"><ShieldCheck size={17} aria-hidden="true" />Blocklist</Link>
          {client && (
            <Link
              className="shell-link"
              href={`/clients/${client.id}/roles`}
            >
              <Briefcase size={17} aria-hidden="true" />
              Client roles
            </Link>
          )}
        </div>
      </nav>
      <div className="shell-footer">
        {/* Owner only. The route refuses anyone else on its own, so this is
            about not advertising a door that will not open. */}
        {data.isOwner && (
          <Link className={itemClass(view, ["team"])} aria-current={view === "team" ? "page" : undefined} href="/team">
            <ShieldCheck size={17} aria-hidden="true" />
            Access
          </Link>
        )}
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
