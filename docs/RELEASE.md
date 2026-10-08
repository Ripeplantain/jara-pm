# Kobi SaaS MVP release notes

## What is in this release

Kobi is an invite-only beta for small product teams. It includes shared workspaces with roles,
boards and rich cards, sprints, activity and notifications, workspace insights, account recovery,
Resend invitations, onboarding, exports/deletion controls, a responsive light/dark UI and a typed
AI copilot with evidence-backed signals, reviewed card-authoring proposals, confirmation for
destructive actions, and a configurable monthly workspace action budget.

Transactional email authorization: Kobi is authorized to send invitation recipient email addresses
and single-use invitation links, with the workspace/inviter/role context needed for the message,
through Resend. The Resend credentials remain backend-only and invitation tokens are stored as
hashes in Kobi’s database.

## Customer support

During the beta, use the support address configured as `RESEND_REPLY_TO` for account and invitation
issues. Include the workspace name, approximate time, request id from the response header when
available, and steps to reproduce. Never send passwords, invitation URLs, API keys or exported
data in a support message.

## Known limitations

- The beta deployment is intentionally one backend replica with persistent SQLite storage.
- Real-time collaboration, attachments, OAuth, integrations, enterprise SSO, billing and mobile
  apps are deferred.
- The AI is assistive. Review suggestions and proposed changes; deterministic signals link to the
  underlying board/card evidence.
- Browser rendering, keyboard traversal, contrast and responsive overflow have been smoke-tested
  against the disposable staging overlay with headless Chrome and axe-core. A human screen-reader
  pass is still required. Production Docker startup, HTTPS and a verified Resend sender also need
  a target-environment smoke before public launch.
- The staging overlay now validates the production-shaped containers, health endpoint, public
  email-link routes and encrypted backup restore. It is not a substitute for the final production
  environment check.

## Release checklist

1. Set distinct staging/production secrets and a verified Resend sender.
2. Run `./scripts/verify.sh` and `npm run build` in `frontend/`.
3. Back up the database and run `bash scripts/restore-check.sh` on the backup.
4. Run the new-user smoke flow and access-isolation checks in `docs/PLAN.md`.
5. Obtain independent security sign-off using [docs/SECURITY_REVIEW_PACKET.md](SECURITY_REVIEW_PACKET.md).
6. Confirm HTTPS, health checks, disk space, logs and the rollback procedure in
   [docs/OPERATIONS.md](OPERATIONS.md).
