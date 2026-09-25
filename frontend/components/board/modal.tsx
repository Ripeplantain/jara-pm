"use client";

import { useEffect, useRef } from "react";

/** Native modal dialog: focus trap and Escape handled by the browser. Mount to open. */
export function Modal({
  label,
  onClose,
  children,
}: {
  label: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);
  return (
    <dialog ref={ref} aria-label={label} onClose={onClose}>
      {children}
    </dialog>
  );
}
