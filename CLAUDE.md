# CLAUDE.md

This repo is public. Everything committed here (skills, docs, specs, plans, tests, fixtures,
screenshots, commit messages) can be read by anyone.

## No personal or private data

- Never put real personal data in any file: names, emails, usernames/handles, phone numbers,
  addresses, account or user IDs, IP addresses, or anything that identifies a person.
- Never put private work context in any file: employer, customer or internal project names,
  private repo names, internal URLs, ticket numbers, Slack channels, or session/transcript content.
- Never commit secrets: tokens, keys, passwords, cookies, `.env` contents, credentials of any kind.
- No machine-specific paths. Use `~/...`, `$HOME`, or paths relative to the repo instead of
  `/Users/<name>/...`.

## Examples and fixtures

- Use obviously fictional, generic data: `example.com` / `example.org` domains, names like
  `alice` / `bob`, repos like `acme/recipe-site`, issue numbers like `#123`.
- Refer to people by role ("the user", "a reviewer"), not by name.
- Screenshots and recordings must show only generic demo data. Check every visible area
  (titles, paths, tabs, avatars) before committing one.
- Don't paste real logs, transcripts, or command output without scrubbing them first.

## Before committing

Scan the diff for anything above (e.g. `git diff --cached | grep -nE '/Users/|@[a-z0-9.-]+\.[a-z]+'`).
If in doubt, replace it with a placeholder.

The one exception: the public repo slug `sergicastro/skills` and marketplace name
`sergicastro-skills`, which are needed for install instructions.
