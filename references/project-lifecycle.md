# GitHub Project lifecycle

GitHub Project v2 has an `open/closed` state. Native Project status updates carry
health/status values `ON_TRACK`, `AT_RISK`, `OFF_TRACK`, `INACTIVE`, and `COMPLETE`.
These are not the per-item `Status` field.

Persist RoleFlow lifecycle mode (`bounded` or `continuous`) and completion criteria
in the Project README. They are workflow contract metadata, not fabricated GitHub
properties.

## Invariants

- Keep a Project open while active product outcomes remain.
- Do not infer `ON_TRACK` merely because work started or checks are green; health
  needs observed schedule/risk evidence.
- Do not infer `COMPLETE` or close the Project from an empty queue, all-Done items,
  archived items, merged PRs, or a completed milestone alone.
- A closed Project, latest `COMPLETE` update, or latest `INACTIVE` update cannot
  silently receive active work. Require explicit reopen/resume authority.
- A continuous Project with no open outcome remains open and asks the CPO for the
  next outcome or milestone.
- A bounded Project with no open work needs verified completion criteria before a
  `COMPLETE` update or close operation.

## Reporting

Reports are read-only. Flag:

- closed Project with open items;
- latest `COMPLETE` update with open items;
- latest `INACTIVE` update with `In Progress`, `In Review`, Ready to Deliver, or
  Delivery Verification items;
- open bounded Project with no open items;
- open continuous Project with no open outcome;
- missing status update as an advisory, not proof of bad health.

Publishing a status update and closing/reopening a Project are separate mutations.
Each requires a direct request and post-mutation re-read.

## Logical phase metadata

`lifecycle.mode`, completion criteria, and logical phases are contract metadata
rather than native Projects v2 properties. Persist each as a single
machine-readable marker block in the Project description (or a linked lifecycle
resource when the description is owner-managed) — phases as
`<!-- github-project-ops:phases [{"key":"...","order":1,"objective":"..."}] -->`
and lifecycle as
`<!-- github-project-ops:lifecycle {"mode":"...","completionCriteria":[...]} -->` —
then read that durable source back in reports so two operators reconstruct the
same `snapshot.phases` from identical Project state.
