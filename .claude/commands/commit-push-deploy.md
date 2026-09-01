---
description: Commit, push, then actively verify the resulting Vercel deployment went out correctly
allowed-tools: Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(git add:*), Bash(git commit:*), Bash(git push:*), Bash(git branch:*), Bash(vercel ls:*), Bash(vercel inspect:*), Bash(curl:*)
---
1. Do the normal commit+push flow for whatever branch I'm currently on — review status/diff, stage relevant files only, commit with the Co-Authored-By footer, push.
2. Never use `vercel deploy` directly to deploy this — a CLI-triggered deploy does not pick up this project's branch-scoped Preview env vars correctly (confirmed root cause of a real CORS outage on 2026-09-01). The git push above is what triggers the correct, env-scoped deployment via Vercel's GitHub integration.
3. After pushing, poll `vercel ls <project-name>` (dg-prints-management-server or dg-prints-management-portal, matching whichever repo I'm in) every ~10s for up to ~2 minutes until a new deployment shows up for this branch with status Ready.
4. Hit the environment's health/root URL to confirm it's actually serving, not just "Ready":
   - `main` → Production URL (`dg-prints-management-server.vercel.app/health` or `dg-prints-management-portal.vercel.app`)
   - `dev` → the `-git-dev-` branch alias specifically, never a one-off preview hash URL
5. Report: commit hash, deployment URL, Ready status, and the health-check result. If the health check fails or times out, show me the deployment's logs (`vercel inspect --logs`, or the inspector URL) instead of guessing.
