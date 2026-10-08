import type { User } from "@/lib/types/auth";

/** Initials on the person's own colour. One component so people look the same everywhere. */
export function Avatar({
  user,
  size = "md",
  showName = false,
}: {
  user: Pick<User, "name" | "email" | "avatar_color">;
  size?: "sm" | "md" | "lg";
  showName?: boolean;
}) {
  const initials = user.name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <span className="avatar-wrap">
      <span
        className={`avatar avatar-${size} tint-${user.avatar_color}`}
        title={showName ? undefined : user.name}
        aria-hidden={showName ? "true" : undefined}
        role={showName ? undefined : "img"}
        aria-label={showName ? undefined : user.name}
      >
        {initials || "?"}
      </span>
      {showName && <span className="avatar-name">{user.name}</span>}
    </span>
  );
}
