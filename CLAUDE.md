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
  - `main` has a ruleset that requires the "Build, test, and dashboard"
    check, so auto-merge waits for CI to pass on the PR's current head.
    If `enable_pr_auto_merge` reports the PR is already clean, that check
    has already passed; merge it directly. Never merge a PR by hand while
    its CI is pending or red.
  - Deploy keys are on the ruleset's bypass list, so the ratchet
    workflows can push baseline commits to `main` with the
    `RATCHET_DEPLOY_KEY` secret (`scripts/push-ratchet-baseline.sh`).
    After adding or rotating that key, run the "Verify ratchet deploy
    key" workflow.
- Still watch subscribed PRs for CI failures and review comments per the
  normal PR-driving rules. Auto-merge only replaces the final manual
  "click merge" step, not the responsibility to get a PR green first.
