---
name: github-project-status
description: Report GitHub Project progress, role queues, milestones, pull-request delivery, lifecycle consistency, risks, and next actions, or explicitly publish a native Project status update. Use for management reports, roadmap checkpoints, health updates, workload reviews, and lifecycle decisions.
---

# GitHub Project Status

Build a read-only management view by default. Publish a native Project status update
or close/reopen the Project only on a direct request with sufficient evidence.

1. Validate the binding and read the Project `open/closed` state, README and short
   description, latest native status update, fields and options, all unarchived
   items, repository milestones, iterations, issue types, assignees, parent/sub-issue
   hierarchy, dependencies, linked PRs, checks, and recent human handoffs.
2. Compute item-count and estimated-effort progress separately; state denominators.
   Distinguish a Project item's `Status` from the underlying Issue open/closed state.
3. Group by repository milestone or outcome, then current role. Separate Ready,
   active, review, Ready to Deliver, Delivery Verification, blocked, decisions,
   stale handoffs, delivery mismatches, and recently completed work.
4. Run `analyze-project-lifecycle.mjs` or `build-project-report.mjs` for snapshots.
   Apply [project-lifecycle.md](../../references/project-lifecycle.md):
   - closed Project with open work → explicit reopen decision;
   - latest `COMPLETE` update with open work → explicit lifecycle correction;
   - latest `INACTIVE` update with active work → explicit resume decision;
   - open continuous Project with an empty queue → keep open and request the next
     CPO outcome;
   - open bounded Project with an empty queue → verify completion criteria before
     publishing `COMPLETE` or closing;
   - never infer `ON_TRACK` or completion solely from issue counts.
5. Recommend at most five next actions from explicit priority, milestone, iteration,
   target date, dependency impact, PR state, and readiness. Do not invent deadlines,
   health, or business value.
6. A direct `publish Project update` request authorizes one native status update
   with `ON_TRACK`, `AT_RISK`, `OFF_TRACK`, `INACTIVE`, or `COMPLETE`, but only when
   the selected value follows observed evidence. Include summary, progress, risks,
   evidence, and next steps; re-read the update afterward.
7. Closing, reopening, or replacing `INACTIVE`/`COMPLETE` remains a distinct Project
   lifecycle mutation and requires explicit authority. Archiving completed items is
   cleanup, not proof that the Project is complete.

Include direct GitHub links, a data timestamp, and a clear distinction between fact,
inference, and missing evidence. Project status updates belong at Project level; do
not substitute an arbitrary Issue comment.
