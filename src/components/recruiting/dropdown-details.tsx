"use client";
import { useEffect, useRef, type ComponentPropsWithoutRef } from "react";

// Only floating menus use this wrapper. Content accordions such as Role Brief
// stay open when the recruiter clicks elsewhere.
export function DropdownDetails(props: ComponentPropsWithoutRef<"details">) {
  const root = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    function dismiss(event: PointerEvent) {
      if (root.current?.open && !root.current.contains(event.target as Node)) root.current.open = false;
    }
    function escape(event: KeyboardEvent) {
      if (event.key !== "Escape" || !root.current?.open) return;
      event.preventDefault();
      event.stopPropagation();
      root.current.open = false;
      root.current.querySelector("summary")?.focus();
    }
    document.addEventListener("pointerdown", dismiss, true);
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("pointerdown", dismiss, true);
      document.removeEventListener("keydown", escape, true);
    };
  }, []);
  return <details {...props} ref={root} />;
}
