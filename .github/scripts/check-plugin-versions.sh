#!/usr/bin/env bash
# Checks the marketplace manifests, and that every plugin changed since BASE has a higher version.
#
# Usage: check-plugin-versions.sh [BASE]   (BASE defaults to origin/main)
# Set SKIP_VERSION_BUMP=true to run the manifest checks only.
set -euo pipefail

base="${1:-origin/main}"
marketplace=.claude-plugin/marketplace.json
semver='^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$'
errors=0

fail() { echo "::error::$*"; errors=$((errors + 1)); }

# 1. Manifests parse, and every marketplace entry points at a real plugin with a matching name.
jq empty "$marketplace" || fail "$marketplace is not valid JSON"
while IFS=$'\t' read -r name source; do
  manifest="$source/.claude-plugin/plugin.json"
  if [[ ! -f "$manifest" ]]; then
    fail "$name: $manifest does not exist"
    continue
  fi
  jq empty "$manifest" || { fail "$manifest is not valid JSON"; continue; }
  [[ "$(jq -r .name "$manifest")" == "$name" ]] || fail "$manifest: name does not match '$name' in $marketplace"
  [[ "$(jq -r '.version // ""' "$manifest")" =~ $semver ]] || fail "$manifest: version is missing or not semver"
done < <(jq -r '.plugins[] | [.name, .source] | @tsv' "$marketplace")

# 2. Every plugin changed since BASE has a higher version.
if [[ "${SKIP_VERSION_BUMP:-false}" == "true" ]]; then
  echo "skip-version-bump is set: not checking version bumps."
else
  changed=$(git diff --name-only "$base"...HEAD -- plugins/ | cut -d/ -f2 | sort -u)
  for plugin in $changed; do
    manifest="plugins/$plugin/.claude-plugin/plugin.json"
    [[ -f "$manifest" ]] || continue  # plugin removed
    new=$(jq -r '.version // ""' "$manifest")
    if ! old=$(git show "$base:$manifest" 2>/dev/null | jq -r '.version // ""'); then
      echo "$plugin: new plugin at $new"
      continue
    fi
    if [[ "$new" == "$old" ]]; then
      fail "$plugin changed but its version is still $old: bump it in $manifest (or add the skip-version-bump label)"
    elif [[ "$(printf '%s\n%s\n' "$old" "$new" | sort -V | tail -1)" != "$new" ]]; then
      fail "$plugin: version went from $old down to $new"
    else
      echo "$plugin: $old -> $new"
    fi
  done
fi

if ((errors)); then
  echo "$errors problem(s) found."
  exit 1
fi
echo "Plugin versions OK."
