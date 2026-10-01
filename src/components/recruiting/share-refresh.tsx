"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function ShareRefresh() {
  const router = useRouter();
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== "visible" ||
          document.activeElement?.matches("input,textarea,[contenteditable=true]")) return;
      router.refresh();
    };
    const timer = window.setInterval(refresh, 20000);
    window.addEventListener("focus", refresh);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [router]);
  return <span>Live sheet · updates automatically</span>;
}
