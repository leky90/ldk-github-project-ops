---
name: github-do-issue
description: Perform one GitHub Project issue as its currently responsible role, verify dependencies and pull-request delivery evidence, and hand work to the next role. Use for requests such as "Hãy thực hiện issue owner/repo#123", including product analysis, technical breakdown, software implementation, QA review, content, marketing, sales, support, and operations work.
---

# Do One GitHub Project Issue

Treat one run as one employee performing one role phase. Do not switch to another
issue or adopt the next role unless the user explicitly expands the request.

## Route the issue

1. Validate the binding. Read the exact Issue, its Project item ID, live Project
   fields and option IDs, Project `Status`, `Role`, delivery phase, repository
   milestone, iteration, assignees, issue type, labels, parent, sub-issues, native
   dependencies, linked PRs, body, resources, DoR/DoD, and latest human handoff.
2. Stop if the Issue is outside the bound Project or allowed repositories. If the
   Issue is not yet a Project item, propose or add it only when the request grants
   that scope.
3. Determine the action from Project `Status`:
   - `Ready`: perform the current owner role.
   - `In Review`: perform the reviewer role.
   - `Ready to Deliver`: perform only the authorized terminal action.
   - `Delivery Verification`: verify terminal evidence and cleanup.
   - `Refinement` or `Blocked`: explain the missing input; do not execute.
   - `Done` or `Canceled`, or a closed Issue: do not repeat delivery. For software,
     reconcile safe local Git closure if relevant, then stop.
4. Check every native `blockedBy` Issue live. A closed-completed blocker is history,
   not an active blocker. Independently verify DoR; if it fails, use one structured
   blocked comment and set `Blocked` or `Refinement`.
5. Respect ownership. If another person is assigned or the item is already active
   under another role, stop unless the user explicitly requests takeover. When
   unassigned, a direct perform request may assign the authenticated GitHub user,
   move the item to `In Progress`, and re-read both fields. This is a coordination
   signal, not a transaction-safe distributed lock.
6. Check Project lifecycle using
   [project-lifecycle.md](../../references/project-lifecycle.md). Never resume an
   inactive/closed Project or replace a `COMPLETE` update without explicit authority.

## Perform and hand off

1. Acquire the packaged issue-local file lock immediately before work. It prevents
   duplicate work in one filesystem only; keep lock data out of GitHub.
2. Perform the actual role deliverable from linked resources. A tech lead may break
   a parent outcome into direct sub-issues when breakdown is the requested result.
3. For software work, use an issue-specific branch and linked worktree, capture a
   clean baseline, limit changes to declared scope, run tests, commit, push, and
   open or update the linked PR as required by DoD. Follow
   [software-work.md](../../references/software-work.md).
4. Update durable resources first. Render and post exactly one human handoff,
   review, or blocked comment; do not post claim/start telemetry.
5. Update `Status`, `Role`, and delivery phase only after evidence is ready:
   - delivery ready for review → `In Review` plus reviewer role;
   - artifact or decision review passed and terminal checks pass → `Done`, then
     close the Issue as completed when configured;
   - action-mode review passed → `Ready to Deliver` plus terminal owner;
   - terminal action completed → `Delivery Verification`;
   - verification passed → `Done` and close completed;
   - changes requested → `Ready` plus previous owner;
   - blocked → `Blocked` or `Refinement`.
6. For `software-merge`, QA proves merge readiness, not delivery. Require a
   non-draft PR, reviewed current SHA, green required checks, no unresolved required
   P1/P2 findings, then merge only with authority. Verify merge and post-merge checks
   before `Done`; perform safe Git closure without deleting dirty, unpushed,
   uniquely unmerged, or unrelated work.
7. Re-read the Issue, Project item fields, assignee, relations, and linked PR.
   Release the local lock and report actual evidence and the next responsible role.

Review approval does not authorize merge, deployment, publishing, outreach,
spending, filing, or production mutation. Never expose tokens, local paths, lock
records, raw validator JSON, or hidden agent coordination in GitHub comments.
