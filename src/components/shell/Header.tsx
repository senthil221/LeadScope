"use client";
import Link from "next/link";
import type { PageData } from "@/lib/types";

export function ShellHeader({ data }: { data: PageData }) {
  const client = data.client ?? null;
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
          <span aria-current="page">Agency workspace</span>
        )}
      </nav>
      <span className="live-indicator">
        <i className={data.live ? "on" : ""} aria-hidden="true" />
        {data.live ? "Search connected" : "Search setup needed"}
      </span>
    </div>
  );
}
