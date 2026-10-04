"use client";
import { useState, useSyncExternalStore } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { serializeRoleFilters } from "@/lib/recruiting/list-filters";
type View = { name: string; filters: Record<string, string>; columns: string };
const eventName = "leadscope:saved-views";
function subscribe(fn: () => void) { window.addEventListener(eventName, fn); window.addEventListener("storage", fn); return () => { window.removeEventListener(eventName, fn); window.removeEventListener("storage", fn); }; }
export function SavedViews({ roleId, stage, columns, onColumns }: { roleId: string; stage: string; columns: string; onColumns: (value: string) => void }) {
  const router = useRouter(); const params = useSearchParams();
  const key = `leadscope:views:${roleId}:${stage}`;
  const saved = useSyncExternalStore(subscribe, () => { try { return localStorage.getItem(key) ?? "[]"; } catch { return "[]"; } }, () => "[]");
  let views: View[] = [];
  try { const parsed = JSON.parse(saved); if (Array.isArray(parsed)) views = parsed.filter((v) => typeof v.name === "string" && v.filters && typeof v.columns === "string").slice(0, 20); } catch { /* Recover malformed preferences. */ }
  const [name, setName] = useState(""); const [error, setError] = useState("");
  function store(next: View[]) { try { localStorage.setItem(key, JSON.stringify(next)); window.dispatchEvent(new Event(eventName)); setError(""); } catch { setError("Browser storage is unavailable. This view could not be saved."); } }
  function open(filters: Record<string, string>, layout?: string) { const p = new URLSearchParams({ stage, ...filters }); if (layout !== undefined) onColumns(layout); router.push(`/roles/${roleId}?${p}`); }
  return <details className="saved-views"><summary>Saved views</summary><div className="saved-views-menu">
    <span className="muted">Quick views for this stage</span><button type="button" onClick={() => open({contact:"missing"})}>Missing mobile</button><button type="button" onClick={() => open({rating:"unrated"})}>Needs rating</button><button type="button" onClick={() => open({stale:"1"})}>7+ days in stage</button>
    {views.map((v, i) => <div className="row" key={v.name}><button type="button" onClick={() => open(v.filters, v.columns)}>{v.name}</button><button type="button" aria-label={`Remove saved view ${v.name}`} onClick={() => store(views.filter((_, index) => index !== i))}>×</button></div>)}
    <label>Save current filters and columns<input aria-label="Saved view name" placeholder="Name this view" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} /></label><button type="button" disabled={!name.trim() || views.length >= 20} onClick={() => { store([...views.filter((v) => v.name !== name.trim()), {name:name.trim(),filters:serializeRoleFilters(params),columns}]); setName(""); }}>Save view</button><small className="muted">Saved on this browser for this role and stage.</small>{error && <p role="alert">{error}</p>}
  </div></details>;
}
