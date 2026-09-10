"use client";
import type { ReactNode } from "react";
import type { PageData } from "@/lib/types";
import { Sidebar } from "./Sidebar";
import { ShellHeader } from "./Header";

export function AppShell({
  data,
  children,
}: {
  data: PageData;
  children: ReactNode;
}) {
  return (
    <div className="shell">
      <Sidebar data={data} />
      <div className="shell-main">
        <ShellHeader data={data} />
        <div className="page-body">{children}</div>
      </div>
    </div>
  );
}
