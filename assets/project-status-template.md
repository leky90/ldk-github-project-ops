# Project status — {{project_title}}

- Data timestamp: {{as_of}} · Layout: **Ops** (default) | **Lanes** (on request: by department / weekly / stakeholder)
- Project state: {{open_or_closed}} · Latest native status update: {{health_or_none}} · Lifecycle consistency: {{result}}
- Totals by state: ✅ n · 🔵 n · 👀 n · ⏳ n · 🚫 n · 📋 n · ❓ n (denominators stated; canceled excluded)

Legend: ✅ Done · 🔵 In Progress · 👀 In Review · ⏳ Ready/Todo · 🚫 Blocked · 📋 Backlog · ❓ Decision.
Every not-done item carries `[Tier · Agent Model/effort · from main|stacked on #n]`.
"⟶ mở" = direct dependents unblocked when done · "← chờ" = blockers (sub-issues / dependencies). Numbers come from the tracker only.

## Progress by milestone / iteration

`M1 Name ▰▰▱▱▱ 40% (2/5 items · 5/13 pts) · target {{date}} · critical path: {{ids}} / blocker: {{id}}`

## Ops layout (default) — clusters by dependency chain

```
🌳 Cluster — {{outcome or milestone}}
├─ ✅ #101 title                           milestone · role/lane              (done: one collapsed line per cluster)
├─ 👀 #102 title                           milestone · role/lane · priority   ⟶ mở #110, #120  review: [Opus/high]
│  ├─ 🔵 #110 title                        milestone · role/lane · priority   ⟶ mở #130        [L · Sonnet/high · stacked on #110]
│  │   └─ ⏳ #110-2 sub-issue                                                 [L · Sonnet/high · stacked on #110]
│  └─ 🚫 #120 title                        milestone · role/lane · priority   ← chờ #102       [M · Sonnet/high · from main]
└─ 📋 #130 title                           milestone · role/lane · priority   ← chờ #110, #111
```

## Lanes layout (on request) — one table per role / department

Lanes: Software · Design · Content · Marketing · QA / Validation · Ops · Decision.

| Ticket | Việc | Milestone | Ưu tiên | TT | Xong thì mở → | Nested | Đề xuất |
|---|---|---|---|---|---|---|---|

## Queues (RoleFlow)

- Ready by role · In Progress · In Review · Ready to Deliver · Delivery Verification · stale handoffs

## Pull-request delivery

- Draft or stale PRs · Review and required-check state · Merge and post-merge verification

## ❓ Decisions pending (owner) — never assigned to an agent

## ▶ Ready queue · ⏸ Waiting · 📊 Totals

## Next actions (≤ 5, evidence-based)

1. {{evidence_based_action}}
