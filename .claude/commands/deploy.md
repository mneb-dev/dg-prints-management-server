---
description: Commit, push, and deploy -- dev branch deploys to Dev, main branch deploys to Production
allowed-tools: Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(git add:*), Bash(git commit:*), Bash(git push:*), Bash(git branch:*), Bash(vercel ls:*), Bash(vercel inspect:*), Bash(curl:*)
---
Commit, push, and verify the deployment -- but ONLY when the current branch is `dev` or `main`.

1. Run `git branch --show-current`. If it is not exactly `dev` or `main`, STOP and tell me my current branch -- this command only drives the two real environments.
2. Run `git status --short` and `git diff` (staged + unstaged), and `git log -5 --oneline` to match this repo's commit message style. If there's nothing to commit, skip straight to step 6 and just verify the latest existing deployment for this branch.
3. Stage only the files relevant to this change (never blind `git add -A`) -- call out anything that looks like a secret or an unrelated in-progress file before staging it.
4. On `main`, show me `git status`/`git diff` and say "This will deploy to Production at <prod URL>" before committing -- main has no branch protection or CI gate, so this push is the only thing standing between the commit and live traffic. On `dev`, just proceed.
5. Write a concise commit message (1-2 sentences on *why*) with this repo's footer convention:
   ```
   <summary line>

   <optional body>

   Co-Authored-By: Claude <noreply@anthropic.com>
   ```
6. Commit, then `git push`. Never use `vercel deploy` directly -- a CLI-triggered deploy does not pick up this project's branch-scoped Preview env vars correctly (confirmed root cause of a real CORS outage on 2026-09-01). The git push is what triggers the correct, env-scoped deployment via Vercel's GitHub integration.
7. Poll `vercel ls <project-name>` (dg-prints-management-server or dg-prints-management-portal, matching whichever repo I'm in) every ~10s for up to ~2 minutes until a deployment for this branch shows status Ready.
8. Hit the environment's health/root URL to confirm it's actually serving, not just "Ready":
   - `main` -> Production URL (`dg-prints-management-server.vercel.app/health` or `dg-prints-management-portal.vercel.app`)
   - `dev` -> the `-git-dev-` branch alias specifically, never a one-off preview hash URL
9. Report: commit hash (if any), deployment URL, Ready status, and the health-check result. If the health check fails or times out, show me the deployment's logs (`vercel inspect --logs`, or the inspector URL) instead of guessing.
