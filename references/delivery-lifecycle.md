# Delivery lifecycle

Declare one delivery mode per Issue:

- `artifact-review`: accepted artifact or decision is terminal.
- `publish`: content or asset must be published and verified.
- `external-action`: outreach, filing, submission, purchase, or another external act.
- `software-merge`: a pull request must merge into the declared target branch.
- `production-release`: an approved build must deploy and pass production checks.
- `operations-change`: an operational or configuration change must be applied and verified.

The contract names the terminal `ownerRole`, target, and observable verification
checks. A role-phase handoff is not terminal evidence.

```text
Ready → In Progress → In Review
                         │
                         ├─ artifact-review + verified → Done
                         └─ action mode → Ready to Deliver
                                              ↓
                                    Delivery Verification
                                              ↓
                                             Done
```

Review approval never implies authority to merge, deploy, publish, spend, contact a
person, file, or mutate production. A new commit invalidates PR review evidence tied
to an older SHA. A failed required check or unresolved required P1/P2 finding blocks
software delivery.


## Handoff v2 events

Handoff v2 event types are `handoff`, `review`, `delivery`, `verification`,
`blocked`, and `reconciliation`. Mutation validation re-reads the Issue and
rejects a stale `issueUpdatedAt` or a logical `transition.from` that no longer
matches. After the final mutation, re-read the Issue and record the result as
`appliedState` in the local handoff — the run's own comment and field writes
advance the timestamp, so `appliedState` is what keeps the handoff fresh for
status reporting.

Decision issues use delivery mode `decision`: a passed independent review with
recorded scope and consequence completes them without the two delivery phases.

Reconciliation repairs are limited to the recorded matrix: `blocked → ready` or
`refinement`, `refinement → ready` (DoR now passes), `in-progress → ready`
(abandoned active work), `ready-to-deliver → in-review`,
`delivery-verification → in-review` or `ready`, and any open state → `canceled`
with explicit authority. Reconciliation never mints `Done`.
