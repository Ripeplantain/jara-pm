"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Avatar } from "@/components/shell/avatar";
import { api, RequestError } from "@/lib/api/browser";
import type { User } from "@/lib/types/auth";

const COLORS = ["indigo", "cyan", "emerald", "amber", "rose", "violet", "slate"];
const message = (err: unknown) =>
  err instanceof RequestError ? err.message : "Something went wrong. Please try again.";

export function ProfileForm({ user }: { user: User }) {
  const router = useRouter();
  const [name, setName] = useState(user.display_name || user.name);
  const [color, setColor] = useState(user.avatar_color);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await api.updateProfile({ display_name: name.trim(), avatar_color: color });
      setSaved(true);
      router.refresh();
    } catch (err) {
      setError(message(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="settings-card" onSubmit={save}>
      <h2>Profile</h2>
      <p className="muted">This is how you appear on cards, comments and the activity feed.</p>

      <div className="profile-preview">
        <Avatar user={{ name: name || user.name, email: user.email, avatar_color: color }} size="lg" />
        <div>
          <strong>{name || user.name}</strong>
          <span className="muted">{user.email}</span>
        </div>
      </div>

      <div className="field">
        <label htmlFor="display-name">Display name</label>
        <input
          id="display-name"
          value={name}
          maxLength={120}
          required
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      <fieldset className="field">
        <legend>Avatar colour</legend>
        <div className="color-choices">
          {COLORS.map((option) => (
            <button
              key={option}
              type="button"
              className={`color-swatch tint-${option}${color === option ? " chosen" : ""}`}
              aria-pressed={color === option}
              aria-label={option}
              onClick={() => setColor(option)}
            />
          ))}
        </div>
      </fieldset>

      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
      {saved && (
        <p role="status" className="notice success">
          Saved.
        </p>
      )}

      <button type="submit" disabled={saving || !name.trim()}>
        {saving ? "Saving…" : "Save profile"}
      </button>
    </form>
  );
}
