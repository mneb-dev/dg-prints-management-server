---
description: Commit a change and apply it identically to BOTH dev and main (infra/config parity changes)
allowed-tools: Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(git add:*), Bash(git commit:*), Bash(git push:*), Bash(git branch:*), Bash(git checkout:*), Bash(git merge:*)
---
Use this when a change should exist identically on both `dev` and `main` — e.g. tooling/config/infra changes that aren't environment-specific.

1. Note the branch I'm currently on (`git branch --show-current`) — this is the "source" branch.
2. Review `git status`/`git diff`, stage only relevant files, write a commit message with the Co-Authored-By footer, and commit on the source branch. Push it.
3. Checkout the OTHER branch (dev if source was main, main if source was dev), confirm it's clean and up to date with its remote.
4. Try `git merge <source> --ff-only` first. If that succeeds, push it — done, cleanly identical history.
5. If fast-forward isn't possible (the branches have diverged), STOP and tell me — do not `cherry-pick` or force anything automatically, since that risks silently dropping or duplicating changes. Show me `git log --oneline <source>..<other>` and `git log --oneline <other>..<source>` so I can decide how to reconcile it.
6. Return me to the original source branch when done.
7. Report both resulting commit hashes and that both `dev` and `main` will now redeploy on Vercel.
