---
description: Commit and push, but only if the current branch is dev
allowed-tools: Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(git add:*), Bash(git commit:*), Bash(git push:*), Bash(git branch:*)
---
Same as a normal commit+push, but GUARDED to the `dev` branch only.

1. Run `git branch --show-current`. If it is not exactly `dev`, STOP immediately and tell me my current branch — do not commit, do not offer to switch branches for me.
2. If it is `dev`, follow the same flow as commit-push: review `git status`/`git diff`, stage only relevant files, write a commit message with the Co-Authored-By footer, commit, and `git push`.
3. Remind me this push triggers a Vercel Preview deployment scoped to `dev`'s env vars (Dev-Database, dev JWT secret, etc.) — not Production.
