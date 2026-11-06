# skills

Claude Code skills, published as a plugin marketplace. Each plugin installs on its own.

| Plugin | What it does |
|---|---|
| [orchestrator](plugins/orchestrator/) | Coordinate several user-created Claude sessions working on one epic: a manager session plans goals and dependencies, worker sessions take goals in parallel. |
| [explain-interactive](plugins/explain-interactive/) | Turn a hard-to-follow explanation into a self-contained, step-by-step interactive HTML page with one shared diagram, a glossary and quizzes. |

## Install

In Claude Code:

    /plugin install <plugin> --marketplace sergicastro/skills

On Claude Code older than 2.1.275, add the marketplace first:

    /plugin marketplace add sergicastro/skills
    /plugin install <plugin>@sergicastro-skills

## Updating

Claude Code updates a plugin when its `version` changes. Auto-update is off by default for
third-party marketplaces, so either turn it on for `sergicastro-skills` in `/plugin` →
Marketplaces, or pull updates by hand:

    /plugin marketplace update sergicastro-skills

Each release is tagged `<plugin>-v<version>` (for example `orchestrator-v0.2.0`), with notes on
the [Releases](https://github.com/sergicastro/skills/releases) page.

## Layout

- `.claude-plugin/marketplace.json`: the list of plugins
- `plugins/<name>/`: one plugin, with its own `.claude-plugin/plugin.json`, `skills/` and tests
- `docs/<name>/`: maintainer docs for a plugin (design specs, plans, README images). They're
  kept out of `plugins/<name>/` because everything there is installed with the plugin, and
  users don't need them

To add a plugin, create `plugins/<name>/` with its manifest and skills, list it in
`marketplace.json`, and run `claude plugin validate .`. Keep each plugin self-contained:
an installed plugin can't reach files outside its own folder.

A plugin's description lives in three places: its `plugin.json`, its `marketplace.json` entry and
the plugin table above. Keep them identical; the **Plugin version check** fails if they differ.

## Releasing

Every PR that changes `plugins/<name>/` must bump `version` in
`plugins/<name>/.claude-plugin/plugin.json` ([semver](https://semver.org): patch for fixes,
minor for features, major for breaking changes). Without a bump, installed copies never update.

- The **Plugin version check** workflow fails the PR if a changed plugin's version didn't go up.
  For changes users don't need (typos, tests), add the `skip-version-bump` label instead.
  Run it locally with `.github/scripts/check-plugin-versions.sh`.
- After merge, the **Plugin release** workflow tags each new version `<name>-v<version>` and
  creates a GitHub Release with the commits since the plugin's previous tag.

## License

MIT. See [LICENSE](LICENSE).
