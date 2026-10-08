# Kobi security review record

This repository contains an internal pre-release review record. It is not a substitute for the
independent security review required before a public launch.

## Reviewed surfaces

- Workspace membership and board/card tenant scoping
- Registration, email verification, password recovery, session invalidation and deactivation
- Invitation preview, resend, expiry and email-bound redemption
- AI tool ids, role checks, prompt-injection handling, proposal confirmation and single-use tokens
- Rate limits, request size limits, CORS, public proxy routes and server-only secrets
- Docker production overlay, SQLite single-replica constraints, backup/restore scripts and logs

## Findings addressed in this build

- Signed-out verification, invite, recovery and reset pages were added to the explicit public
  proxy allowlist so Resend links work without an existing session.
- AI authoring proposals are preview-only; confirmation tokens are hashed, user/board-bound,
  expiring and single-use. Batch proposals validate every card before the first write.
- Invitation links sent through Resend are also single-use and now store only a SHA-256 hash in the
  database; the raw link is held only for the outbound email call.
- AI context excludes email addresses, password hashes, lifecycle tokens, invite links and provider
  secrets. Request logs redact invite-token path segments.
- Monthly AI budgets and request/IP limits prevent an unbounded provider bill in the single-replica
  beta.
- Verification-email resend requests are now rate-limited alongside login, registration, recovery,
  invitations and AI requests.
- An address with an open workspace invitation must register through the emailed invite token;
  matching the email alone cannot redeem the workspace membership.
- Account lifecycle tokens and AI proposal tokens are claimed with conditional database updates;
  this preserves single-use behavior under concurrent requests even though SQLite ignores row-level
  `SELECT ... FOR UPDATE` locking.

## Required independent gate

An external reviewer must repeat the surface review against a deployed staging environment and
record any findings here before public launch. Until then, 18.5 and the final launch gate remain
open.

## Dependency verification

Next.js and `eslint-config-next` are on 16.4.0. The production dependency audit is clean as of
2026-10-08. The remaining development-only audit findings are in the eslint toolchain and are not
included in the production image; they should be rechecked when the upstream dependency chain
publishes a compatible fix.

The redacted `gitleaks detect` scan completed against repository history on 2026-10-08 with no
leaks found. This does not inspect external provider dashboards or replace the required independent
application review.
