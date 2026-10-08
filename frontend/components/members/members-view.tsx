"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Modal } from "@/components/board/modal";
import { Avatar } from "@/components/shell/avatar";
import { api, RequestError } from "@/lib/api/browser";
import type { User } from "@/lib/types/auth";
import type { Invite, Member, Role, Workspace } from "@/lib/types/workspace";
import { atLeast, canAdminister, ROLE_DESCRIPTION, ROLES } from "@/lib/types/workspace";

const message = (err: unknown) =>
  err instanceof RequestError ? err.message : "Something went wrong. Please try again.";

/**
 * Who is in the workspace, and what they may do.
 *
 * The backend is the authority on every rule here (last owner, granting a role above your own);
 * this view hides what the viewer cannot do so they are not offered a button that will 403, and
 * still shows the server's message when a rule fires anyway.
 */
export function MembersView({
  workspace,
  members: initialMembers,
  invites: initialInvites,
  me,
}: {
  workspace: Workspace;
  members: Member[];
  invites: Invite[];
  me: User;
}) {
  const router = useRouter();
  const [members, setMembers] = useState(initialMembers);
  const [invites, setInvites] = useState(initialInvites);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("member");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Member | null>(null);

  const myRole = workspace.my_role;
  const mayManage = canAdminister(myRole);
  const owners = members.filter((m) => m.role === "owner").length;

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  const invite = (e: React.FormEvent) => {
    e.preventDefault();
    const address = email.trim();
    if (!address) return;
    run(async () => {
      const result = await api.invite(workspace.id, address, role);
      setEmail("");
      if (result.kind === "member" && result.member) {
        setMembers((list) => [...list, result.member as Member]);
        setNotice(`${address} already had an account and is now a ${role}.`);
      } else if (result.invite) {
        setInvites((list) => [...list, result.invite as Invite]);
        setNotice(`Invited ${address}. They join as a ${role} when they sign up.`);
      }
      router.refresh();
    });
  };

  const changeRole = (member: Member, next: Role) =>
    run(async () => {
      const updated = await api.changeRole(workspace.id, member.user_id, next);
      setMembers((list) => list.map((m) => (m.user_id === member.user_id ? updated : m)));
      router.refresh();
    });

  const remove = (member: Member) =>
    run(async () => {
      await api.removeMember(workspace.id, member.user_id);
      setMembers((list) => list.filter((m) => m.user_id !== member.user_id));
      if (member.user_id === me.id) {
        // You just left: you can no longer read this page.
        router.push("/");
      }
      router.refresh();
    });

  const revoke = (inviteRow: Invite) =>
    run(async () => {
      await api.revokeInvite(workspace.id, inviteRow.id);
      setInvites((list) => list.filter((i) => i.id !== inviteRow.id));
    });

  const resend = (inviteRow: Invite) =>
    run(async () => {
      const updated = await api.resendInvite(workspace.id, inviteRow.id);
      setInvites((list) => list.map((i) => (i.id === updated.id ? updated : i)));
      setNotice(`Invitation resent to ${inviteRow.email}.`);
    });

  /** You cannot hand out a role above your own, and the last owner is locked in place. */
  function mayChange(member: Member): boolean {
    if (!mayManage) return false;
    if (member.role === "owner" && !atLeast(myRole, "owner")) return false;
    return true;
  }

  function lockedReason(member: Member): string | null {
    if (member.role === "owner" && owners === 1) return "The last owner cannot be changed";
    if (member.role === "owner" && !atLeast(myRole, "owner")) return "Only an owner can change an owner";
    return null;
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">{workspace.name}</div>
          <h1>Members</h1>
          <p>
            {members.length} {members.length === 1 ? "person" : "people"}
            {invites.length > 0 && `, ${invites.length} pending`}
          </p>
        </div>
      </div>

      {mayManage ? (
        <form className="invite-form" onSubmit={invite}>
          <div className="field">
            <label htmlFor="invite-email">Invite by email</label>
            <input
              id="invite-email"
              type="email"
              value={email}
              required
              placeholder="colleague@example.com"
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="invite-role">Role</label>
            <select
              id="invite-role"
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
            >
              {ROLES.filter((r) => atLeast(myRole, r)).map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <p className="field-hint">{ROLE_DESCRIPTION[role]}</p>
          </div>
          <button type="submit" disabled={busy || !email.trim()}>
            {busy ? "Sending…" : "Invite"}
          </button>
        </form>
      ) : (
        <p className="muted notice">Only admins and owners can invite or change people here.</p>
      )}

      {error && (
        <p role="alert" className="error-banner">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="notice success">
          {notice}
        </p>
      )}

      <table className="member-table">
        <caption className="sr-only">Workspace members and their roles</caption>
        <thead>
          <tr>
            <th scope="col">Person</th>
            <th scope="col">Role</th>
            <th scope="col">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {members.map((member) => {
            const locked = lockedReason(member);
            return (
              <tr key={member.user_id}>
                <td>
                  <div className="member-cell">
                    <Avatar user={member.user} />
                    <div>
                      <strong>
                        {member.user.name}
                        {member.user_id === me.id && <span className="you-chip">you</span>}
                      </strong>
                      <span className="muted">{member.user.email}</span>
                    </div>
                  </div>
                </td>
                <td>
                  {mayChange(member) && !locked ? (
                    <select
                      aria-label={`Role for ${member.user.name}`}
                      value={member.role}
                      disabled={busy}
                      onChange={(e) => changeRole(member, e.target.value as Role)}
                    >
                      {ROLES.filter((r) => atLeast(myRole, r)).map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className={`role-chip role-${member.role}`} title={locked ?? undefined}>
                      {member.role}
                    </span>
                  )}
                </td>
                <td className="row-end">
                  {(mayChange(member) || member.user_id === me.id) && !locked && (
                    <button type="button" disabled={busy} onClick={() => setRemoving(member)}>
                      {member.user_id === me.id ? "Leave" : "Remove"}
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {mayManage && (
        <section aria-labelledby="pending-heading" className="pending-invites">
          <h2 id="pending-heading">Pending invitations</h2>
          <p className="muted">
            These addresses have no account yet. They join automatically when they sign up or use
            the invitation link.
          </p>
          {invites.length ? (
            <ul>
              {invites.map((inviteRow) => (
                <li key={inviteRow.id}>
                  <span>{inviteRow.email}</span>
                  <span className={`role-chip role-${inviteRow.role}`}>{inviteRow.role}</span>
                  <span className="muted">
                    expires {new Date(inviteRow.expires_at).toLocaleDateString()}
                  </span>
                  <button type="button" disabled={busy} onClick={() => resend(inviteRow)}>
                    Resend
                  </button>
                  <button type="button" disabled={busy} onClick={() => revoke(inviteRow)}>
                    Revoke
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No pending invitations.</p>
          )}
        </section>
      )}

      {removing && (
        <Modal label="Remove member" onClose={() => setRemoving(null)}>
          <h2>
            {removing.user_id === me.id
              ? `Leave ${workspace.name}?`
              : `Remove ${removing.user.name}?`}
          </h2>
          <p>
            {removing.user_id === me.id
              ? "You will lose access to every board in this workspace."
              : `${removing.user.name} loses access to every board in this workspace. Their cards and comments stay.`}
          </p>
          <div className="row-actions">
            <button
              type="button"
              className="danger"
              onClick={() => {
                const member = removing;
                setRemoving(null);
                remove(member);
              }}
            >
              {removing.user_id === me.id ? "Leave workspace" : "Remove"}
            </button>
            <button type="button" onClick={() => setRemoving(null)}>
              Cancel
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
