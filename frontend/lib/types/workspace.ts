/** Mirror backend/app/schemas/workspaces.py. */
import type { User } from "@/lib/types/auth";

/** Weakest to strongest. Compare with `atLeast`, never with `<`. */
export type Role = "viewer" | "member" | "admin" | "owner";

const RANK: Record<Role, number> = { viewer: 0, member: 1, admin: 2, owner: 3 };

export const atLeast = (role: Role | undefined, minimum: Role) =>
  role !== undefined && RANK[role] >= RANK[minimum];

export const canWrite = (role: Role | undefined) => atLeast(role, "member");
export const canAdminister = (role: Role | undefined) => atLeast(role, "admin");

export const ROLES: Role[] = ["viewer", "member", "admin", "owner"];

export const ROLE_DESCRIPTION: Record<Role, string> = {
  viewer: "Can read everything, change nothing",
  member: "Can create and edit boards, columns and cards",
  admin: "Everything a member can do, plus managing people and labels",
  owner: "Full control, including deleting the workspace",
};

export interface Member {
  user_id: number;
  role: Role;
  created_at: string;
  user: User;
}

export interface Workspace {
  id: number;
  name: string;
  created_at: string;
  my_role: Role;
  members: Member[];
}

export interface Invite {
  id: number;
  workspace_id: number;
  email: string;
  role: Role;
  invited_by_id: number | null;
  created_at: string;
  expires_at: string;
}

/** Inviting does one of two things, and says which. */
export interface InviteResult {
  kind: "invite" | "member";
  invite: Invite | null;
  member: Member | null;
}

export interface OnboardingStatus {
  completed: boolean;
  workspace_id: number | null;
  workspace_name?: string | null;
  board_id: number | null;
  sprint_id: number | null;
  completed_at?: string | null;
}
