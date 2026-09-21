#!/bin/sh
# wait-ci.sh <workflow> <sha>: block until that workflow's run for that commit
# exists and finishes; exit non-zero unless it succeeded. No pipes on the
# command whose status matters.
set -eu
wf=$1; sha=$2; n=0
while :; do
  id=$(gh run list --workflow "$wf" --commit "$sha" --limit 1 --json databaseId --jq '.[0].databaseId // empty')
  [ -n "$id" ] && break
  n=$((n+1)); [ $n -lt 60 ] || { echo "no $wf run appeared for $sha"; exit 1; }
  sleep 5
done
gh run watch "$id" --interval 20 --exit-status >/dev/null 2>&1 || true
c=$(gh run view "$id" --json conclusion --jq .conclusion)
echo "$wf run $id for $(echo "$sha" | cut -c1-7): $c"
[ "$c" = success ]
