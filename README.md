# LDK GitHub Project Ops

`ldk-github-project-ops` applies the RoleFlow work model to GitHub Projects v2,
Issues, sub-issues, dependencies, repository milestones, and pull requests. It is a
separate plugin from `ldk-linear-project-ops`; no Linear data, binding, API key,
SQLite database, claim daemon, or scheduled worker is shared.

When both repository bindings exist, explicit GitHub or Linear names, URLs, and
native identifiers select the tracker. A generic request such as “create the issues”
is intentionally ambiguous and must not write to either tracker until the owner
chooses one. See `references/tracker-routing.md`.

## Public skills

- `github-create-work`: turn briefs and goals into Project fields, milestones,
  parent issues, sub-issues, decisions, and dependencies.
- `github-do-issue`: perform one issue as its current role and hand it to the next
  role with review or delivery evidence.
- `github-project-status`: report queues, milestones, pull-request delivery,
  lifecycle consistency, risks, and next actions.
- `github-reconcile`: repair inconsistent fields, issue state, relations, and
  delivery evidence.

## Native mapping

| RoleFlow concept | GitHub native surface |
|---|---|
| Project | GitHub Project v2 |
| Project lifecycle | Project `open/closed` plus native status updates |
| Work state | Project single-select `Status` field |
| Outcome | Parent Issue |
| Task / decision | Issue or sub-issue |
| Dependency | Native issue dependency |
| Checkpoint | Repository milestone or Project iteration |
| Resource | Repository document, Project README, Discussion, or approved URL |
| Software delivery | Linked branch and pull request |

GitHub does not have a Linear-style native Initiative. The plugin does not invent
one. Use one Project for a bounded or explicitly continuous product outcome, and use
organization-level Projects or multiple Projects for portfolio planning.

## Binding

Copy `examples/project-binding.example.json` to `.github-project-ops.json` in a
consumer repository and replace every example value. The binding stores identifiers
and field contracts only; never place tokens in it.

The host uses its connected GitHub app for issues and pull requests when possible,
and `gh project` or `gh api graphql` for Project v2 operations not exposed by the
connector. `gh` needs the `project` scope. Check with `gh auth status` and, when
needed, authorize it interactively with `gh auth refresh -s project`.

## Recommended Project fields

- `Status`: Refinement, Ready, In Progress, In Review, Ready to Deliver,
  Delivery Verification, Blocked, Done, Canceled.
- `Role`: project-specific role options.
- `Priority`: Urgent, High, Normal, Low, None.
- `Delivery phase`: Artifact Review, Ready to Deliver, Delivery Verification.
- `Estimate`: number.
- `Start date`, `Target date`: dates.
- `Iteration`: native iteration field when time-boxing is useful.

Use repository milestone, assignee, issue type, labels, sub-issues, dependencies,
and linked pull requests for the metadata GitHub already provides natively.

Required schema-v2 saved-view specifications are `Delivery board` grouped by Status,
`Role queues` grouped by Role, `Roadmap` using start/target dates,
`Review & delivery` filtered to review and terminal-action states, plus separate
`Blocked` and `Decisions` views. Saved views update their displayed membership and
grouping as item fields change after the view changes are saved. Enable built-in
synchronization deliberately; the plugin always re-reads item Status and Issue/PR
state after a write.

Estimation is lightweight by default: use one relative Fibonacci point on executable
children when it helps, never estimate parent outcomes, and allow a short omission
reason instead of detailed effort accounting.
