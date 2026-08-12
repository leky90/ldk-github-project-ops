# Codex and Claude Code adapters

Prefer the connected GitHub app for repository, Issue, pull-request, comment, label,
reaction, and review-adjacent data. Use local `git` and authenticated `gh` for
Project v2 operations, current checkout context, branch/commit work, Actions logs,
and API gaps.

## Project v2 reads

```sh
gh auth status
gh project view PROJECT_NUMBER --owner OWNER --format json
gh project field-list PROJECT_NUMBER --owner OWNER --format json
gh project item-list PROJECT_NUMBER --owner OWNER --limit 1000 --format json
```

The token needs the `project` scope. If missing, report the gap and let the user run
the interactive authorization command:

```sh
gh auth refresh -s project
```

Do not request or store a PAT when the connected app or authenticated `gh` suffices.

## Mutations

- Add actual Issues with `gh project item-add`.
- Update one field at a time with `gh project item-edit`, using the live Project,
  item, field, and option IDs.
- Create/edit Issues with `gh issue`; use native sub-issue and dependency flags when
  supported by the installed CLI.
- Use `gh api graphql` for Project status updates or relation operations absent from
  the connector/CLI. Name the mutation and re-read its returned object.

Never fake a Project status update with an Issue comment. Never treat an item field
write as proof that the underlying Issue was closed or the PR merged.

Local locks and baselines live under ignored `.github-ops/`. Hosts on different
machines do not share them. GitHub assignee plus item status is the cross-machine
human coordination signal; it is not a strict distributed mutex.
