#!/usr/bin/env bash
# Commits a raised ratchet baseline and pushes it to main over SSH with the ratchet deploy key
# (repository secret RATCHET_DEPLOY_KEY: a write-enabled deploy key on main's ruleset bypass list).
# Pushing with the key rather than the Actions token means the baseline commit isn't blocked by
# main's required CI check, and the workflows' own token can stay read-only. The key only ever
# exists in a temp file for the lifetime of this script.
#
#   scripts/push-ratchet-baseline.sh <baseline-file> <commit-subject>
#       commit the baseline file if it changed, and push it to main
#   scripts/push-ratchet-baseline.sh --verify
#       prove the key can push: push HEAD to a throwaway branch, then delete it
#
# Needs RATCHET_DEPLOY_KEY, REPOSITORY (owner/name), and GITHUB_TOKEN (read-only is enough; it is
# used only to fetch GitHub's SSH host keys) in the environment.
set -euo pipefail

require_key() {
  if [[ -z "${RATCHET_DEPLOY_KEY:-}" ]]; then
    echo "RATCHET_DEPLOY_KEY is not set: add the ratchet deploy key's private key as a repository secret." >&2
    exit 1
  fi
}

setup_ssh() {
  keydir="$(mktemp -d)"
  trap 'rm -rf "$keydir"' EXIT
  printf '%s\n' "$RATCHET_DEPLOY_KEY" > "$keydir/key"
  chmod 600 "$keydir/key"
  # GitHub's published SSH host keys, fetched over TLS, rather than trusting whatever
  # ssh-keyscan happens to be answered with.
  curl -fsSL -H "Authorization: Bearer ${GITHUB_TOKEN}" https://api.github.com/meta \
    | jq -r '.ssh_keys[] | "github.com " + .' > "$keydir/known_hosts"
  export GIT_SSH_COMMAND="ssh -i $keydir/key -o IdentitiesOnly=yes -o UserKnownHostsFile=$keydir/known_hosts -o StrictHostKeyChecking=yes"
  remote="git@github.com:${REPOSITORY}.git"
}

if [[ "${1:-}" == "--verify" ]]; then
  require_key
  setup_ssh
  probe="refs/heads/ratchet-key-check-${GITHUB_RUN_ID:-local}"
  git push "$remote" "HEAD:${probe}"
  git push "$remote" --delete "$probe"
  echo "The ratchet deploy key can push to ${REPOSITORY}."
  exit 0
fi

file="$1"
subject="$2"
if git diff --quiet -- "$file"; then
  echo "No change to ${file} to record."
  exit 0
fi
require_key
git config user.name "github-actions[bot]"
git config user.email "github-actions[bot]@users.noreply.github.com"
git add "$file"
git commit -m "$subject" -m "$(git diff --cached -- "$file")"

setup_ssh
# The sibling ratchet runs on the same push and may land first, as may another merge. The two
# baseline files never overlap, so rebasing this one-line commit onto the new main and retrying is
# safe; a genuine conflict still fails the job loudly.
for attempt in 1 2 3; do
  if git push "$remote" HEAD:main; then exit 0; fi
  echo "main moved since checkout (attempt ${attempt}); rebasing onto it and retrying."
  git pull --rebase "$remote" main
done
echo "Could not push the raised baseline after 3 attempts." >&2
exit 1
