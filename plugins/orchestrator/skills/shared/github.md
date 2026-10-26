# GitHub procedures

Use these only when the orchestration has a `board` (state.json) or the goal has
GitHub links. Every command uses the `gh` CLI. `@me` is the user.

## Read an epic (manager)

```bash
gh issue view <n> --repo <owner/repo> --json number,title,body,state,url,labels,assignees,projectItems,comments
gh api repos/<owner>/<repo>/issues/<n>/sub_issues --jq '.[] | {number, title, state, html_url}'
```
Linked issues: look for `#123`, `owner/repo#123` or issue URLs in the body and comments,
and read them with `gh issue view` as well.

## Find the board and Status options (manager)

`projectItems` from `gh issue view` lists the projects the epic is on. Then:
```bash
gh project view <number> --owner <owner> --format json --jq '{id, title, url}'
gh project field-list <number> --owner <owner> --format json \
  --jq '.fields[] | select(.name=="Status") | {id, options}'
```
Propose a mapping from goal states (`ready`, `assigned`, `in-review`, `done`) to the
option names, and let the user confirm it. Store `board: {"project": "<owner>/<number>",
"field": "Status", "mapping": {...}}` in the plan.

## Assign an issue to the user and put it on the board (manager, after confirmation)

```bash
gh issue edit <n> --repo <owner/repo> --add-assignee @me
gh project item-add <number> --owner <owner> --url <issue url> --format json --jq .id   # prints ITEM_ID
```

## Set an item's status (manager or worker)

```bash
PROJECT_ID=$(gh project view <number> --owner <owner> --format json --jq .id)
FIELD_JSON=$(gh project field-list <number> --owner <owner> --format json --jq '.fields[] | select(.name=="<field>")')
FIELD_ID=$(jq -r .id <<<"$FIELD_JSON")
OPTION_ID=$(jq -r --arg v "<value>" '.options[] | select(.name==$v) | .id' <<<"$FIELD_JSON")
ITEM_ID=$(gh project item-list <number> --owner <owner> --format json --limit 500 \
  --jq '.items[] | select(.content.url=="<issue url>") | .id')
gh project item-edit --id "$ITEM_ID" --project-id "$PROJECT_ID" --field-id "$FIELD_ID" --single-select-option-id "$OPTION_ID"
```

## Link a PR to its issue (worker)

Put `Closes #<n>` (or `Closes <owner/repo>#<n>`) in the PR body, or comment on the
issue: `gh issue comment <n> --repo <owner/repo> --body "PR: <url>"`.

## Check alignment (manager, on DONE / approval / status)

```bash
gh issue view <n> --repo <owner/repo> --json state,assignees,projectItems,closedByPullRequestsReferences
```
Compare against state.json: the board status matches the mapping for the goal's state,
the issue is assigned to the user, and the handoff PR is linked. Fix what's missing
with the commands above, then tell the user what you fixed.

## Epic progress comment (manager owns the epic)

Create it once and store its id under `epic.progress_comment` in the plan (before init)
or note it in your reply if it was created later:
```bash
gh issue comment <n> --repo <owner/repo> --body-file <file> # then find its id:
gh api repos/<owner>/<repo>/issues/<n>/comments --jq '.[-1].id'
gh api -X PATCH repos/<owner>/<repo>/issues/comments/<id> -F body=@<file>   # update
```
The body is a checklist: `- [x] g1 Title (#101, PR #210)` for done goals and
`- [ ] g2 Title (#102) — <state>` for the rest. Set the epic's own board status from the
mapping: `assigned` while any goal is open, `done` when all are done.
