# GitHub-native work model

Use the lowest native object that matches the planning altitude.

| Need | Native GitHub surface |
|---|---|
| Product or program workspace | Project v2 |
| Project context and operating contract | Project README and short description |
| Executive health update | Project status update |
| Release or repository checkpoint | Repository milestone |
| Recurring time box | Project iteration field |
| Manager-readable outcome | Parent Issue |
| Independently owned deliverable | Issue or direct sub-issue |
| Explicit judgment or authority | Issue/sub-issue with decision type or label |
| Prerequisite | Native issue dependency |
| Software change | Linked branch and pull request |
| Durable brief, PRD, plan, or report | Repository document, Discussion, or approved URL |

GitHub has no Linear-style native Initiative. Do not create an Issue named
"Initiative" merely to imitate one. Use a higher-level organization Project, a
portfolio repository, or multiple linked Projects when a goal spans products.

## Canonical hierarchy

```text
GitHub Project v2
├── Project README and status updates
├── Repository milestone / Project iteration
└── Parent outcome Issue
    └── Direct task or decision sub-issue
        └── Linked pull request when software changes are required
```

Keep one direct sub-issue level for normal execution. GitHub supports deeper trees,
but RoleFlow splits only when ownership, deliverable, dependency, reviewer, or
terminal action differs. Do not create agent time-slice issues.

Prefer actual Issues over draft Project items once work is approved. Draft items do
not provide the same repository ownership, relations, PR linkage, and audit surface.

## Required Project fields

- `Status`: workflow state for each Project item.
- `Role`: current responsible role.
- `Priority`: explicit relative priority.
- `Delivery phase`: terminal delivery checkpoint when needed.
- `Estimate`: optional number field.
- `Start date` and `Target date`: optional date fields.
- `Iteration`: optional native iteration field.

Resolve field and option node IDs live before every mutation. Names are contract
defaults, not stable API IDs. A consumer binding may map different names.
