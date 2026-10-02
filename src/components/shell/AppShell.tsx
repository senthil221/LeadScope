"use client";
import type { ReactNode } from "react";
import type { PageData } from "@/lib/types";
import { Sidebar } from "./Sidebar";
import { ShellHeader } from "./Header";
import styles from "./app-shell.module.css";

export function AppShell({
  data,
  children,
}: {
  data: PageData;
  children: ReactNode;
}) {
  return (
    <div className={`shell ${styles.workspace}`}>
      <a className={styles.skipLink} href="#workspace-content">Skip to workspace</a>
      <Sidebar data={data} />
      <div className="shell-main">
        <ShellHeader data={data} />
        <main id="workspace-content" className="page-body" tabIndex={-1}>{children}</main>
      </div>
    </div>
  );
}
