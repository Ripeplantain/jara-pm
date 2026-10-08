# Independent security review packet

Status: pending an external reviewer. The repository's internal review is recorded in
[`SECURITY_REVIEW.md`](SECURITY_REVIEW.md) and is not being counted as independent sign-off.

## Review target

Review the Kobi SaaS MVP staging deployment, using a disposable database and non-production
credentials. Do not use production data or send test messages to unapproved recipients.

The review should cover:

- tenant isolation across workspaces, boards, cards, members, exports, activity and notifications;
- registration, email verification, password recovery, deactivation, deletion and session
  invalidation;
- Resend invitation preview, token-bound redemption, expiry, resend rotation and revocation;
- role checks for viewer/member/admin/owner operations and the proxy allowlist;
- AI context isolation, prompt-injection resistance, tool permissions, proposal confirmation,
  single-use proposal tokens and monthly budgets;
- request/IP limits, request-size limits, CORS, security headers, log redaction and error output;
- Docker non-root boundaries, runtime secret exposure, SQLite single-replica assumptions and
  encrypted backup/restore handling.

## Reproduction evidence

From the repository root, the maintainer can provide:

```sh
./scripts/verify.sh
bash scripts/migration-check.sh
gitleaks detect --source . --redact --no-banner --report-format json \
  --report-path /private/tmp/kobi-gitleaks-review.json
```

For the rendered application, start the staging overlay with separate staging values from
`.env`, use a disposable account, and run the procedure in [`VISUAL_QA.md`](VISUAL_QA.md).
The reviewer should independently exercise the HTTP/API paths as well as the browser paths;
passing automated tests is evidence, not a substitute for the reviewer's judgment.

## Sign-off

- Reviewer:
- Organization:
- Environment and commit:
- Date:
- Findings:
- Regression tests added for confirmed findings:
- Residual risks accepted by release owner:
- Decision: pending / approved / rejected
