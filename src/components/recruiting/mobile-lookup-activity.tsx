"use client";
import { useEffect, useRef, useState } from "react";
import { Phone } from "lucide-react";
import type { MobileLookupCell } from "@/lib/recruiting/mobile-waterfall";
type Summary = { active: number; review: number; resultVersion: string | null; cells?: MobileLookupCell[] };
export function MobileLookupActivity({ roleId, candidateIds, version, onUpdate, onStates, onOpen }: { roleId: string; candidateIds: string[]; version: number; onUpdate: () => void; onStates: (cells: MobileLookupCell[]) => void; onOpen: () => void }) {
  const [counts, setCounts] = useState({ active: 0, review: 0 });
  const lastResult = useRef<{ role: string; version: string | null } | null>(null);
  const updateRef = useRef(onUpdate), statesRef = useRef(onStates);
  useEffect(() => { updateRef.current = onUpdate; statesRef.current = onStates; }, [onUpdate, onStates]);
  // Stable across rerenders; new slices of the table request their own state.
  const idsKey = [...new Set(candidateIds)].sort().join(",");
  useEffect(() => {
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const ids = idsKey ? idsKey.split(",") : [];
        const batches: string[][] = [];
        for (let i = 0; i < ids.length; i += 200) batches.push(ids.slice(i, i + 200));
        if (!batches.length) batches.push([]);
        const results: Summary[] = [];
        // Bound each read and the request concurrency, even on a large sheet.
        for (let i = 0; i < batches.length; i += 4) {
          results.push(...await Promise.all(batches.slice(i, i + 4).map(async (batch) => {
            const params = new URLSearchParams({ role: roleId, summary: "1" });
            if (batch.length) params.set("candidates", batch.join(","));
            const response = await fetch(`/api/mobile-waterfall?${params}`, { signal: controller.signal });
            if (!response.ok) throw new Error("Lookup status unavailable");
            return response.json() as Promise<Summary>;
          })));
        }
        if (controller.signal.aborted) return;
        const result = results[0];
        statesRef.current(results.flatMap((batch) => batch.cells ?? []));
        if (lastResult.current?.role === roleId && lastResult.current.version !== result.resultVersion) updateRef.current();
        lastResult.current = { role: roleId, version: result.resultVersion };
        setCounts({ active: result.active, review: result.review });
        if (result.active > 0) timer = setTimeout(() => void poll(), 10000);
      } catch { if (!controller.signal.aborted) timer = setTimeout(() => void poll(), 30000); }
    }
    void poll(); return () => { controller.abort(); clearTimeout(timer); };
  }, [roleId, idsKey, version]);
  if (!counts.active && !counts.review) return null;
  return <button className="mobile-activity" onClick={onOpen}><Phone size={13} />{counts.active > 0 ? `${counts.active} mobile lookups running` : `${counts.review} mobile lookups need review`}</button>;
}
