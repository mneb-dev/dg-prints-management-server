---
description: Merge a feature/other branch into dev to test it in the Dev environment
argument-hint: [branch-name]
allowed-tools: Bash(git status:*), Bash(git branch:*), Bash(git checkout:*), Bash(git merge:*), Bash(git push:*), Bash(git log:*)
---
Merge $ARGUMENTS (or, if not given, my current branch) into `dev`.

1. Confirm the source branch exists and note its name; if $ARGUMENTS is empty, use `git branch --show-current` as the source (and refuse if the source is `dev` or `main` itself).
2. `git checkout dev`, make sure it's clean and up to date with `origin/dev`.
3. `git merge <source> --no-ff` (keep a merge commit so the feature's history is visible in dev — don't squash).
4. If there are conflicts, stop and show me the conflicting files rather than resolving them yourself.
5. Push `dev`. This triggers the dev Preview deployment.
6. Report the merge commit hash and remind me to verify in the dev environment before promoting to main (`/promote-to-main`).
