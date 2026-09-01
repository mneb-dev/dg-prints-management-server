---
description: Promote the currently-verified dev branch to main (Production release)
allowed-tools: Bash(git status:*), Bash(git branch:*), Bash(git checkout:*), Bash(git merge:*), Bash(git push:*), Bash(git log:*)
---
Ship what's currently on `dev` to `main` (Production). Only run this after dev has been verified working.

1. `git checkout main`, ensure it's clean and up to date with `origin/main`.
2. Show me `git log --oneline main..dev` — the commits about to go to Production — before doing anything else.
3. Try `git merge dev --ff-only` first (keeps main's history linear, which should be the normal case if `main` is never committed to directly). If that works, push it.
4. If fast-forward isn't possible, STOP and show me why (`git log --oneline dev..main` — commits on main that aren't on dev) rather than force-merging; that usually means something was pushed directly to main out of band, worth noticing rather than steamrolling.
5. After pushing, remind me this just triggered a Production deployment and suggest running `/commit-push-deploy`-style verification against the Production URL.
