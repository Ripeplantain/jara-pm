"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, RequestError } from "@/lib/api/browser";
import type { Role } from "@/lib/types/workspace";

const templates = [
  ["product-roadmap", "Product roadmap", "Ideas, now, next and shipped"],
  ["kanban", "Kanban", "A simple backlog, doing and done flow"],
  ["scrum", "Scrum", "Backlog, review and sprint-ready work"],
] as const;

export function OnboardingView() {
  const router = useRouter();
  const [workspaceName, setWorkspaceName] = useState("");
  const [context, setContext] = useState("");
  const [teamSize, setTeamSize] = useState("3");
  const [template, setTemplate] = useState("product-roadmap");
  const [sprintName, setSprintName] = useState("First sprint");
  const [sprintGoal, setSprintGoal] = useState("");
  const [emails, setEmails] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function finish(demo = false) {
    setPending(true);
    setError(null);
    try {
      if (demo) {
        await api.completeDemoOnboarding();
      } else {
        const invites = emails
          .split(/[\n,]/)
          .map((email) => email.trim())
          .filter(Boolean)
          .map((email) => ({ email, role: "member" as Role }));
        await api.completeOnboarding({
          workspace_name: workspaceName,
          product_context: context,
          team_size: Number(teamSize),
          board_template: template,
          sprint_name: sprintName,
          sprint_goal: sprintGoal,
          invites,
        });
      }
      router.push("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof RequestError ? err.message : "Could not finish setup. Try again.");
      setPending(false);
    }
  }

  return (
    <div className="onboarding-card">
      <div className="eyebrow">A quick start for your team</div>
      <h1>Set up your product workspace</h1>
      <p className="onboarding-intro">
        Give Kobi a little context, choose a starting shape, and you&apos;ll have a useful board in
        under a minute.
      </p>
      {error && <p className="error-banner" role="alert">{error}</p>}
      <div className="onboarding-grid">
        <label className="field">
          Workspace name
          <input value={workspaceName} required placeholder="Acme product" onChange={(e) => setWorkspaceName(e.target.value)} />
        </label>
        <label className="field">
          Team size
          <select value={teamSize} onChange={(e) => setTeamSize(e.target.value)}>
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((size) => <option key={size} value={size}>{size}</option>)}
          </select>
        </label>
      </div>
      <label className="field">
        What are you building?
        <textarea value={context} rows={3} placeholder="A short description helps your AI copilot understand the team." onChange={(e) => setContext(e.target.value)} />
      </label>
      <fieldset className="template-picker">
        <legend>Choose a starting board</legend>
        <div className="template-options">
          {templates.map(([key, name, description]) => (
            <label key={key} className={`template-option${template === key ? " selected" : ""}`}>
              <input type="radio" name="template" value={key} checked={template === key} onChange={() => setTemplate(key)} />
              <strong>{name}</strong>
              <span>{description}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="onboarding-grid">
        <label className="field">
          First sprint
          <input value={sprintName} onChange={(e) => setSprintName(e.target.value)} />
        </label>
        <label className="field">
          Sprint goal
          <input value={sprintGoal} placeholder="What will move forward?" onChange={(e) => setSprintGoal(e.target.value)} />
        </label>
      </div>
      <label className="field">
        Invite teammates <span className="muted">(optional)</span>
        <textarea value={emails} rows={2} placeholder="One email per line or separated by commas" onChange={(e) => setEmails(e.target.value)} />
      </label>
      <div className="onboarding-actions">
        <button type="button" disabled={pending || !workspaceName.trim()} onClick={() => void finish()}>
          {pending ? "Creating your workspace…" : "Create workspace"}
        </button>
        <button type="button" className="secondary" disabled={pending} onClick={() => void finish(true)}>
          Start with a demo
        </button>
      </div>
    </div>
  );
}
