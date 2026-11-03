#!/usr/bin/env bash
# Tags and releases every plugin whose current version has no <name>-v<version> tag yet.
# Safe to re-run: plugins that are already tagged are skipped.
#
# Needs: git with push access, gh authenticated (GH_TOKEN), jq.
set -euo pipefail

sha=$(git rev-parse HEAD)

for manifest in plugins/*/.claude-plugin/plugin.json; do
  name=$(jq -r .name "$manifest")
  version=$(jq -r .version "$manifest")
  tag="$name-v$version"
  dir=$(dirname "$(dirname "$manifest")")

  if git rev-parse -q --verify "refs/tags/$tag" >/dev/null; then
    echo "$tag already exists, skipping."
    continue
  fi

  previous=$(git tag -l "$name-v*" --sort=-v:refname | head -1)
  if [[ -n "$previous" ]]; then
    notes="Changes since $previous:"$'\n\n'"$(git log --format='- %s (%h)' "$previous..$sha" -- "$dir")"
  else
    notes="First tagged release of $name."
  fi

  git tag -a "$tag" -m "$name $version" "$sha"
  git push origin "refs/tags/$tag"
  gh release create "$tag" --verify-tag --title "$name $version" --notes "$notes"
  echo "Released $tag."
done
