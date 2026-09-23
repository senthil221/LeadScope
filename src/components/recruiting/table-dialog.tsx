"use client";
import { useEffect, useRef, type ReactNode } from "react";

export function TableDialog({ titleId, busy = false, wide = false, onClose, children }: {
  titleId: string; busy?: boolean; wide?: boolean; onClose: () => void; children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return <dialog ref={ref} className="modal table-dialog" data-wide={wide} aria-labelledby={titleId}
    onKeyDown={(event) => event.stopPropagation()}
    onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    {children}
  </dialog>;
}
