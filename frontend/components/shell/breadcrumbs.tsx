"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function Breadcrumbs({ context }: { context?: string }) {
  const pathname = usePathname();
  const label = context ?? (pathname === "/" ? "Boards" : pathname.split("/")[1]?.replaceAll("-", " "));
  if (!label) return null;
  return (
    <div className="breadcrumbs" aria-label="Breadcrumb">
      <Link href="/">Workspace</Link><span aria-hidden="true">/</span><strong>{label}</strong>
    </div>
  );
}
