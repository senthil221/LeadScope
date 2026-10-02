"use client";
import { useEffect, useRef, useState } from "react";
import { Phone } from "lucide-react";
export function MobileLookupActivity({ roleId, version, onUpdate, onOpen }: { roleId: string; version: number; onUpdate: () => void; onOpen: () => void }) {
  const [counts, setCounts] = useState({ active: 0, review: 0 });
  const lastResult = useRef<string | null | undefined>(undefined), updateRef = useRef(onUpdate);
  useEffect(() => { updateRef.current = onUpdate; }, [onUpdate]);
  useEffect(() => {
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const response = await fetch(`/api/mobile-waterfall?role=${roleId}&summary=1`, { signal: controller.signal });
        if (!response.ok) return;
        const result: { active: number; review: number; resultVersion: string | null } = await response.json();
        if (controller.signal.aborted) return;
        if (lastResult.current !== undefined && lastResult.current !== result.resultVersion) updateRef.current();
        lastResult.current = result.resultVersion; setCounts({ active: result.active, review: result.review });
        if (result.active > 0) timer = setTimeout(() => void poll(), 10000);
      } catch { if (!controller.signal.aborted) timer = setTimeout(() => void poll(), 30000); }
    }
    void poll(); return () => { controller.abort(); clearTimeout(timer); };
  }, [roleId, version]);
  if (!counts.active && !counts.review) return null;
  return <button className="mobile-activity" onClick={onOpen}><Phone size={13} />{counts.active > 0 ? `${counts.active} mobile lookups running` : `${counts.review} mobile lookups need review`}</button>;
}
