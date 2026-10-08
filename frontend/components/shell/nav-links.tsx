"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { canAdminister } from "@/lib/types/workspace";
import type { Role } from "@/lib/types/workspace";

interface NavLink {
  href: string;
  label: string;
  /** "/" would otherwise prefix-match every page. */
  exact?: boolean;
}

const LINKS: NavLink[] = [
  { href: "/", label: "Boards", exact: true },
  { href: "/my-work", label: "My work" },
  { href: "/activity", label: "Activity" },
  { href: "/members", label: "Members" },
];

/** Primary navigation. Members is shown to everyone but only admins can change anything there. */
export function NavLinks({ role }: { role: Role }) {
  const pathname = usePathname();
  return (
    <ul className="nav-links">
      {LINKS.map((link) => {
        const current = link.exact ? pathname === link.href : pathname.startsWith(link.href);
        return (
          <li key={link.href}>
            <Link href={link.href} aria-current={current ? "page" : undefined}>
              {link.label}
              {link.href === "/members" && canAdminister(role) && (
                <span className="nav-hint" aria-hidden="true">
                  •
                </span>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
