# CLAUDE.md

Repo-specific instructions for Claude Code sessions working on this project.

## PR workflow

- Open pull requests ready for review, not as a draft.
- Immediately after opening (or updating) a PR, enable GitHub's native
  auto-merge on it (the `enable_pr_auto_merge` MCP tool, or `gh pr merge
  --auto`), so GitHub merges it automatically once CI passes — no manual
  merge step, and no need for a Claude session to stay alive watching it.
  - This requires "Allow auto-merge" to be turned on in the repo's
    Settings → General → Pull Requests. If enabling auto-merge fails
    because that setting is off, say so and stop — don't fall back to
    merging manually without asking first.
  - `main` currently has no branch protection (no required status checks,
    no required reviews), so auto-merge fires as soon as CI reports
    success. If branch protection requiring reviews is added later,
    auto-merge will simply wait for those too — nothing here needs to
    change.
- Still watch subscribed PRs for CI failures and review comments per the
  normal PR-driving rules. Auto-merge only replaces the final manual
  "click merge" step, not the responsibility to get a PR green first.
