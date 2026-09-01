---
description: Review changes, write a commit message, and push the current branch
allowed-tools: Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(git add:*), Bash(git commit:*), Bash(git push:*), Bash(git branch:*)
---
Commit and push whatever is currently staged/unstaged on the CURRENT branch (whatever it is).

1. Run `git status --short --branch` and `git diff` (staged + unstaged) to see what changed. Run `git log -5 --oneline` to match this repo's commit message style.
2. If there is nothing to commit, say so and stop.
3. Stage only the files relevant to this change (never blind `git add -A`) — call out anything that looks like a secret or an unrelated in-progress file before staging it.
4. Write a concise commit message (1-2 sentences on *why*, not a changelog) using this repo's existing footer convention:
   ```
   <summary line>

   <optional body>

   Co-Authored-By: Claude <noreply@anthropic.com>
   ```
5. Commit, then push to the current branch's upstream (`git push`, or `git push -u origin <branch>` if there's no upstream yet).
6. Report the resulting commit hash and whether this branch is `dev`, `main`, or something else — if it's `dev`/`main`, remind me Vercel will auto-deploy this push (use `/commit-push-deploy` instead if I want you to verify the deployment too).
