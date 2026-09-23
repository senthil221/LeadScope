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

export function useTableLayout(scope: string) {
  const key = `leadscope:table-widths:v1:${scope}`;
  const saved = useSyncExternalStore(subscribe, () => read(key), () => "");
  const density = useSyncExternalStore(subscribe, () => read("leadscope:table-density"), () => "");
  let widths: Record<string, number> = {};
  try {
    const value: unknown = JSON.parse(saved);
    if (value && typeof value === "object" && !Array.isArray(value)) {
      widths = Object.fromEntries(Object.entries(value).filter(([, width]) =>
        typeof width === "number" && Number.isFinite(width) && width >= 72 && width <= 480,
      ));
    }
  } catch { /* Ignore old or malformed preferences. */ }
  // Compact is the working default: these tables are read all day, and the
  // extra row padding costs about four visible candidates a screen. Only an
  // explicit switch to comfortable turns it off, so the server render and the
  // first client render agree when nothing has been stored yet.
  const compact = density !== "comfortable";
  return {
    compact,
    toggleDensity: () => write("leadscope:table-density", compact ? "comfortable" : "compact"),
    width: (id: string, initial: number) => widths[id] ?? initial,
    resize: (id: string, width: number) => write(key, JSON.stringify({ ...widths, [id]: Math.max(72, Math.min(480, Math.round(width))) })),
    reset: () => write(key, "{}"),
  };
}

export function ColumnResizeHandle({ label, width, onResize }: {
  label: string;
  width: number;
  onResize: (width: number) => void;
}) {
  const drag = useRef<{ x: number; width: number } | null>(null);
  return (
    <button
      type="button"
      className="column-resize-handle"
      aria-label={`Resize ${label} column`}
      title="Drag to resize; use Left and Right arrow keys for fine adjustments"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        drag.current = { x: event.clientX, width };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (drag.current) onResize(drag.current.width + event.clientX - drag.current.x);
      }}
      onPointerUp={(event) => {
        drag.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onLostPointerCapture={() => { drag.current = null; }}
      onPointerCancel={() => { drag.current = null; }}
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        onResize(width + (event.key === "ArrowRight" ? 16 : -16));
      }}
    />
  );
}
