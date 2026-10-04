"use client";

import { useRef, useSyncExternalStore } from "react";

const changeEvent = "leadscope:table-layout";
function subscribe(listener: () => void) {
  window.addEventListener("storage", listener);
  window.addEventListener(changeEvent, listener);
  return () => {
    window.removeEventListener("storage", listener);
    window.removeEventListener(changeEvent, listener);
  };
}
const fallback = new Map<string, string>();
function read(key: string) {
  try { return localStorage.getItem(key) ?? fallback.get(key) ?? ""; }
  catch { return fallback.get(key) ?? ""; }
}
function write(key: string, value: string) {
  fallback.set(key, value);
  try { localStorage.setItem(key, value); } catch { /* Session-only when storage is unavailable. */ }
  window.dispatchEvent(new Event(changeEvent));
}

export function useTableLayout(scope: string, compactByDefault = true, widthVersion = 1) {
  const key = `leadscope:table-widths:v${widthVersion}:${scope}`;
  const saved = useSyncExternalStore(subscribe, () => read(key), () => "");
  // Density is remembered per scope rather than once for the whole app: the
  // triage stages are scanned in bulk and want the rows tight, while the later
  // stages are read a row at a time and want the room.
  const densityKey = `leadscope:table-density:v2:${scope}`;
  const density = useSyncExternalStore(subscribe, () => read(densityKey), () => "");
  let widths: Record<string, number> = {};
  try {
    const value: unknown = JSON.parse(saved);
    if (value && typeof value === "object" && !Array.isArray(value)) {
      widths = Object.fromEntries(Object.entries(value).filter(([, width]) =>
        typeof width === "number" && Number.isFinite(width) && width >= 72 && width <= 2400,
      ));
    }
  } catch { /* Ignore old or malformed preferences. */ }
  // Nothing stored means this scope's own default, so the server render and
  // the first client render agree. An explicit choice always wins.
  const compact = density === "" ? compactByDefault : density !== "comfortable";
  return {
    compact,
    hasWidths: Object.keys(widths).length > 0,
    resizeColumns: (next: Record<string, number>) => write(key, JSON.stringify(Object.fromEntries(Object.entries({ ...widths, ...next }).map(([id, width]) => [id, Math.max(72, Math.min(2400, Math.round(width)))])))),
    toggleDensity: () => write(densityKey, compact ? "comfortable" : "compact"),
    width: (id: string, initial: number) => widths[id] ?? initial,
    resize: (id: string, width: number) => write(key, JSON.stringify({ ...widths, [id]: Math.max(72, Math.min(2400, Math.round(width))) })),
    reset: () => write(key, "{}"),
  };
}

type ResizeDrag = { x: number; width: number; next: number; table: HTMLTableElement; col: HTMLTableColElement; tableWidth: number; tableStyle: string; minStyle: string; colStyle: string };
export function ColumnResizeHandle({ label, width, minWidth = 72, onResize }: {
  label: string; width: number; minWidth?: number; onResize: (width: number) => void;
}) {
  const drag = useRef<ResizeDrag | null>(null);
  const clamp = (value: number) => Math.max(minWidth, Math.min(2400, Math.round(value)));
  function finish(commit: boolean) {
    const current = drag.current;
    if (!current) return;
    drag.current = null;
    current.col.style.width = current.colStyle;
    current.table.style.width = current.tableStyle;
    current.table.style.minWidth = current.minStyle;
    if (commit) onResize(current.next);
  }
  return <button type="button" className="column-resize-handle" aria-label={`Resize ${label} column`}
    title="Drag to resize; use Left and Right arrow keys for fine adjustments"
    onPointerDown={(event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      const heading = event.currentTarget.closest('th');
      const table = heading?.closest('table');
      const col = table?.querySelectorAll('col')[heading!.cellIndex];
      if (!table || !col || !heading) return;
      const actualWidth = heading.getBoundingClientRect().width;
      drag.current = { x: event.clientX, width: actualWidth, next: actualWidth, table, col, tableWidth: table.getBoundingClientRect().width, tableStyle: table.style.width, minStyle: table.style.minWidth, colStyle: col.style.width };
      event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onPointerMove={(event) => {
      const current = drag.current;
      if (!current) return;
      current.next = clamp(current.width + event.clientX - current.x);
      // Preview only column geometry. Re-render and persist once on release,
      // instead of rebuilding hundreds of editable cells on every mouse move.
      current.col.style.width = current.next + 'px';
      const tableWidth = current.tableWidth + current.next - current.width;
      current.table.style.width = tableWidth + 'px';
      current.table.style.minWidth = tableWidth + 'px';
    }}
    onPointerUp={(event) => { finish(true); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
    onLostPointerCapture={() => finish(false)} onPointerCancel={() => finish(false)}
    onKeyDown={(event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault(); onResize(clamp(width + (event.key === "ArrowRight" ? 16 : -16)));
    }} />;
}
