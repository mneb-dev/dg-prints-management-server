---
description: Commit and push on any branch that is NOT dev or main (feature branches)
allowed-tools: Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(git add:*), Bash(git commit:*), Bash(git push:*), Bash(git branch:*)
---
1. Run `git branch --show-current`. If it IS `dev` or `main`, stop and tell me to use /commit-push-dev or /commit-push-main instead.
2. Otherwise, review `git status`/`git diff`, stage only relevant files, write a commit message (Co-Authored-By footer), commit.
3. Push with `git push -u origin <branch>` if there's no upstream yet, otherwise `git push`.
4. Heads-up in the report: this triggers a Vercel Preview build using the fallback (non-branch-scoped) Preview env vars pointed at the Dev-Database — same as `dev`, just without a matching frontend CORS_ORIGIN, so browser calls to it will be permissive/open rather than restricted. That's expected and harmless for a throwaway feature-branch preview.
