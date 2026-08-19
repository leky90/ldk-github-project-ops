---
name: github-create-work
description: Create or update native GitHub Projects v2 fields, repository milestones, parent issues, sub-issues, decisions, dependencies, briefs, PRDs, and role-owned work. Use when an owner asks to brainstorm, draft, plan, create, organize, schedule, or update strategic and execution work in GitHub Projects.
---

# Create GitHub Project Work

Turn an owner's intent into native GitHub planning objects and human-readable,
role-owned work packets. Read [github-native-model.md](../../references/github-native-model.md)
before selecting objects. For every create, update, sync, breakdown, backlog, or
view request, also read [project-setup.md](../../references/project-setup.md) and
[tracker-routing.md](../../references/tracker-routing.md).

1. Load and validate `.github-project-ops.json`; pin the owner, Project number or
   node ID, and allowed repositories. Never infer a different Project from a title,
   stale context, or another tracker. If an explicit GitHub request has no binding,
   perform read-only discovery and produce an exact binding preview. Write the
   binding only when the target is unambiguous and the request authorizes setup.
2. Prefer the connected GitHub app for repository, Issue, pull-request, comment,
   label, and milestone operations. Use authenticated `gh project` and
   `gh api graphql` for Project v2 fields, item field values, status updates, and
   native relations that the connector does not expose. Follow
   [host-adapters.md](../../references/host-adapters.md).
3. Read the Project, fields and option IDs, saved views, built-in workflows, linked
   repositories, items, repository milestones, issue
   types, labels, assignees, sub-issues, dependencies, linked PRs, and existing
   resources before drafting. Resolve live IDs; never hard-code option IDs.
4. Treat `draft`, `propose`, `analyze`, or `preview` as read-only. A direct
   `create`, `update`, or `sync` authorizes scoped writes. Require a new decision
   for deletion, bulk changes, repository expansion, close/reopen, or production
   actions.
5. Use actual Issues for approved executable work. Use a Project draft issue only
   for unapproved intake; convert it before execution. Store briefs and PRDs in a
   repository document, Project README, Discussion, or approved external document,
   then link them from Issues. Do not put full artifacts in comments.
6. Draft a schema-v2 `schemas/work-plan.schema.json`. Use a parent Issue for an outcome, direct
   sub-issues for independently owned tasks or decisions, native issue dependencies
   for blockers, repository milestones for release checkpoints, and Project
   iterations for recurring time boxes. Build a requirement-to-issue coverage map.
   There is no target issue count: split until each child has one owner, one
   reviewable deliverable, and independently verifiable acceptance criteria. Every
   applied outcome must have at least one direct child.
7. Use the organization issue type when the requested type exists. Otherwise use
   `kind:outcome`, `kind:task`, or `kind:decision` labels; never create organization
   issue types without owner authority.
8. Give each issue one current `Role` field value, DoR, role-phase DoD, acceptance
   criteria, and a delivery contract from
   [delivery-lifecycle.md](../../references/delivery-lifecycle.md). Split artifact
   approval from merge, deployment, publishing, outreach, filing, spending, or
   other terminal action when authority or evidence differs.
9. Default to lightweight estimation: one relative Fibonacci point from
   `1, 2, 3, 5, 8, 13` on executable tasks and decisions when it helps sequencing
   or capacity planning. Omit estimates from parent outcomes to avoid double
   counting. If an item cannot be usefully sized, record a short `estimateReason`;
   do not require hour-by-hour effort narratives. Use `estimation.mode: none` when
   sizing adds no decision value.
10. Audit setup even for an existing Project. The v2 plan must declare field,
    workflow, and saved-view policy, including the standard dynamic views. Preserve
    custom semantics; preview conflicts instead of silently rewriting them.
11. Validate the plan with `validate-work-plan.mjs`; require `--apply` for writes.
    Apply setup prerequisites and resources first, then milestones, parent issues,
    sub-issues, Project membership and field values, followed by dependencies.
12. Re-read every created object, saved view, field value, and both ends of each
    relation. Capture `schemas/project-result.schema.json` and require
    `validate-project-result.mjs` to pass. Reconcile the coverage map against actual items. Report created,
    updated, skipped, conflicted, and failed items with direct GitHub links. A partial
    apply is not complete merely because some issues exist.

Creating planned work does not prove execution began. Do not close a Project or
publish a `COMPLETE` status update merely because the current plan is Done.

If a native object or field cannot be mutated through the available connector or
CLI, preserve a validated preview and report the exact capability or permission gap;
do not emulate it with a misleading Issue or comment.
