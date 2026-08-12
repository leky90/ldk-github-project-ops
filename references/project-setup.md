# GitHub Project setup

Configure once per Project and keep field names in `.github-project-ops.json`.

## Fields

1. Customize the built-in `Status` single-select to the RoleFlow states when the
   Project owner accepts the workflow.
2. Create `Role`, `Priority`, and `Delivery phase` as single-select fields.
3. Create `Estimate` as a number field.
4. Add `Start date`, `Target date`, and an iteration field only when planning needs
   them. The current `gh project field-create` command supports text, number, date,
   and single-select; use the Project UI or an explicitly supported API path for an
   iteration field.
5. Query `gh project field-list ... --format json` and persist names in the binding,
   not field or option IDs. Resolve IDs live before mutation.

Do not silently replace an existing team's Status semantics. If the required options
are missing, produce an exact setup preview and stop workflow-state writes until the
owner approves field changes.

## Views

- `Delivery board`: board grouped by Status.
- `Role queues`: table or board grouped by Role.
- `Roadmap`: roadmap using start and target dates, with milestone/iteration markers.
- `Review & delivery`: filter to In Review, Ready to Deliver, and Delivery Verification.
- `Blocked & decisions`: filter blocked items and decision issue type/label.

## Built-in workflows

Use `item added → Ready` only when newly added items are genuinely role-ready;
otherwise default to Refinement. GitHub can synchronize closed Issues and merged PRs
to Done. Treat that automation as a convenience: delivery verification may still
require correcting a premature Done field. Auto-archive retains field values but
removes items from Insights, so archive only after reporting and audit needs are met.
