"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

export function RoleToolsMenu({ label, active = false, children }: { label: string; active?: boolean; children: ReactNode }) {
  const root = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    function dismiss(event: PointerEvent) {
      if (root.current && !root.current.contains(event.target as Node)) root.current.open = false;
    }
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape" && root.current?.open) {
        event.preventDefault();
        event.stopPropagation();
        root.current.open = false;
        root.current.querySelector("summary")?.focus();
      }
    }
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", escape, true);
    };
  }, []);

  return (
    <details ref={root} name="role-workspace-tools" className="role-tools-menu" onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) event.currentTarget.open = false;
    }}>
      <summary className={active ? "selected" : undefined}>{label}<ChevronDown size={14} aria-hidden="true" /></summary>
      <div className="role-tools-popover" onClick={(event) => {
        if ((event.target as Element).closest("a, button") && root.current) {
          root.current.open = false;
          root.current.querySelector("summary")?.focus();
        }
      }}>{children}</div>
    </details>
  );
}
