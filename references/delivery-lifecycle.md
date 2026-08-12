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
