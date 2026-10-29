# skills

Claude Code skills, published as a plugin marketplace. Each plugin installs on its own.

| Plugin | What it does |
|---|---|
| [orchestrator](plugins/orchestrator/) | Coordinate several user-created Claude sessions working on one epic: a manager session plans goals and dependencies, worker sessions take goals in parallel. |

## Install

In Claude Code:

    /plugin install <plugin> --marketplace sergicastro/skills

On Claude Code older than 2.1.275, add the marketplace first:

    /plugin marketplace add sergicastro/skills
    /plugin install <plugin>@sergicastro-skills

## Layout

- `.claude-plugin/marketplace.json`: the list of plugins
- `plugins/<name>/`: one plugin, with its own `.claude-plugin/plugin.json`, `skills/`, tests and docs

To add a plugin, create `plugins/<name>/` with its manifest and skills, list it in
`marketplace.json`, and run `claude plugin validate .`. Keep each plugin self-contained:
an installed plugin can't reach files outside its own folder.

## License

MIT. See [LICENSE](LICENSE).
