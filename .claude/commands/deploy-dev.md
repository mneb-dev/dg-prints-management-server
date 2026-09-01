---
description: Commit, push, and deploy to the Dev environment (dev branch only)
allowed-tools: Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(git add:*), Bash(git commit:*), Bash(git push:*), Bash(git branch:*), Bash(vercel ls:*), Bash(vercel inspect:*), Bash(curl:*)
---
Commit, push, and verify the deployment to Dev -- but ONLY when the current branch is `dev`.

1. Run `git branch --show-current`. If it is not exactly `dev`, STOP and tell me my current branch -- this command only drives the Dev environment.
2. Run `git status --short` and `git diff` (staged + unstaged), and `git log -5 --oneline` to match this repo's commit message style. If there's nothing to commit, skip straight to step 5 and just verify the latest existing deployment.
3. Stage only the files relevant to this change (never blind `git add -A`) -- call out anything that looks like a secret or an unrelated in-progress file before staging it.
4. Write a concise commit message (1-2 sentences on *why*) with this repo's footer convention:
   ```
   <summary line>

   <optional body>

   Co-Authored-By: Claude <noreply@anthropic.com>
   ```
   Commit, then `git push`. Never use `vercel deploy` directly -- a CLI-triggered deploy does not pick up this project's branch-scoped Preview env vars correctly (confirmed root cause of a real CORS outage on 2026-09-01). The git push is what triggers the correct, env-scoped deployment via Vercel's GitHub integration.
5. Poll `vercel ls <project-name>` (dg-prints-management-server or dg-prints-management-portal, matching whichever repo I'm in) every ~10s for up to ~2 minutes until a deployment for `dev` shows status Ready.
6. Hit the `-git-dev-` branch alias health/root URL to confirm it's actually serving, not just "Ready" -- never a one-off preview hash URL.
7. Report: commit hash (if any), deployment URL, Ready status, and the health-check result. If the health check fails or times out, show me the deployment's logs (`vercel inspect --logs`, or the inspector URL) instead of guessing.
