---
description: Commit and push, but only if the current branch is main (production)
allowed-tools: Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(git add:*), Bash(git commit:*), Bash(git push:*), Bash(git branch:*)
---
Same as commit-push-dev, but guarded to `main`, and treated as a PRODUCTION push — be more careful.

1. Run `git branch --show-current`. If it is not exactly `main`, STOP and tell me my current branch.
2. Show me `git status`/`git diff` and a one-line summary of what's about to go to Production before doing anything else.
3. Stage only relevant files, write the commit message (Co-Authored-By footer), commit.
4. Before pushing, explicitly say "This will deploy to Production at <prod URL>" — this repo has no branch protection or CI gate yet, so this push is the only thing standing between this commit and live traffic.
5. Push, then report the commit hash. Suggest running `/commit-push-deploy`-style verification against the Production URL afterward.
