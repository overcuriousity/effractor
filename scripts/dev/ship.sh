#!/bin/sh
# ship.sh <title> <pr-body-file> <commit-message-file>
#
# Land the current branch the way this repository lands work: verify locally,
# commit, open a PR, wait for *that commit's* CI run to succeed, then
# fast-forward master and push. Fast-forward, not GitHub's merge button: master
# carries the author's commit signatures, and a server-side merge commit would
# be signed by GitHub instead.
set -eu
title=$1; body=$2; message=$3
here=$(dirname "$0")
branch=$(git branch --show-current)
[ "$branch" != master ] || { echo "ship from a branch, not master"; exit 1; }

node scripts/check-roadmap.js
cargo fmt --all --check
RUSTFLAGS="-D warnings" cargo clippy --workspace --all-targets --locked -q

# Tracked changes, and new files the author staged by name: never every
# untracked file (a local data/ of shares, a node_modules link).
git add -u
git commit -qF "$message"
git push -qu origin "$branch"
url=$(gh pr create --title "$title" --body-file "$body")
echo "$url"

# The status of this line is the gate. Never pipe it into anything: a pipe
# reports the last command's status, and that once merged two PRs before CI ran.
"$here/wait-ci.sh" ci.yml "$(git rev-parse HEAD)"

git switch -q master
git merge --ff-only -q "$branch"
git push -q origin master
git push -q origin --delete "$branch"
git branch -qd "$branch"

# Every push to master is a release; it is part of landing the work.
"$here/wait-ci.sh" release.yml "$(git rev-parse HEAD)"
