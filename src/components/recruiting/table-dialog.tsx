"use client";
import { useEffect, useRef, type ReactNode } from "react";

export function DialogLoading() {
  return <div className="dialog-loading" role="status"><span className="spinner" aria-hidden="true" />Opening panel…</div>;
}

export function TableDialog({ titleId, busy = false, wide = false, className = "", onClose, children }: {
  titleId: string; busy?: boolean; wide?: boolean; className?: string; onClose: () => void; children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog?.showModal();
    dialog?.querySelector<HTMLElement>("[data-dialog-autofocus]")?.focus();
    return () => {
      dialog?.close();
      // React removes the dialog before passive cleanup. Restore the trigger
      // after that removal so keyboard users can continue where they started.
      queueMicrotask(() => { if (returnFocus?.isConnected) returnFocus.focus(); });
    };
  }, []);
  return <dialog ref={ref} className={`modal table-dialog ${className}`.trim()} data-wide={wide} aria-labelledby={titleId}
    onKeyDown={(event) => event.stopPropagation()}
    onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    {children}
  </dialog>;
}
