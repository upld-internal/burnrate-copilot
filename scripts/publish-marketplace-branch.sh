#!/bin/sh
# Publishes one verified signed release to a marketplace branch.
#
#   scripts/publish-marketplace-branch.sh VERSION BRANCH
#
# BRANCH is `marketplace-pilot` for machines testing with a file-based
# managed-settings.json, or `marketplace` for the enterprise-managed rollout.
# Promotion publishes the same verified version to `marketplace`.
#
# Requires a clean checkout of tag vVERSION, an authenticated `gh` with access
# to the private repository, and `cosign`. The commit is signed with the
# user's configured Git signing key when one is set.
set -eu

version=${1:?usage: publish-marketplace-branch.sh VERSION BRANCH}
branch=${2:?usage: publish-marketplace-branch.sh VERSION BRANCH}
case "$branch" in
  marketplace|marketplace-pilot) ;;
  *) echo "branch must be marketplace or marketplace-pilot" >&2; exit 1 ;;
esac

root=$(cd "$(dirname "$0")/.." && pwd)
test "$(git -C "$root" rev-parse HEAD)" = "$(git -C "$root" rev-parse "v$version^{commit}")" || {
  echo "check out tag v$version before publishing" >&2
  exit 1
}

work=$(mktemp -d "${TMPDIR:-/tmp}/burnrate-publish.XXXXXX")
trap 'git -C "$root" worktree remove --force "$work/branch" >/dev/null 2>&1 || true; rm -rf "$work"' EXIT

python3 "$root/scripts/build-marketplace-package.py" "$version" "$work/package"

git -C "$root" fetch --quiet origin
if git -C "$root" ls-remote --exit-code --heads origin "$branch" >/dev/null; then
  git -C "$root" worktree add --quiet "$work/branch" "origin/$branch"
  git -C "$work/branch" switch --quiet -C "$branch"
else
  git -C "$root" worktree add --quiet --detach "$work/branch"
  git -C "$work/branch" switch --quiet --orphan "$branch"
fi

# The branch holds exactly the verified package: remove everything, then copy.
git -C "$work/branch" rm -r --quiet --ignore-unmatch .
cp -R "$work/package/." "$work/branch/"
git -C "$work/branch" add --all
if git -C "$work/branch" diff --cached --quiet; then
  echo "$branch already contains the verified v$version package"
  exit 0
fi
git -C "$work/branch" commit --quiet -m "Publish verified burnrate-copilot v$version marketplace package"
git -C "$work/branch" push --quiet origin "$branch"
echo "published v$version to $branch at $(git -C "$work/branch" rev-parse HEAD)"
