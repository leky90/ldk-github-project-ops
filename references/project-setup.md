# GitHub Project setup

Audit on every planning or synchronization run, configure when authorized, and keep
field names in `.github-project-ops.json`. Existing Projects are not exempt: missing
fields, views, repository links, or workflows must appear in the preview and final
report.

## Fields

1. Customize the built-in `Status` single-select to the RoleFlow states when the
   Project owner accepts the workflow.
2. Create `Role`, `Priority`, and `Delivery phase` as single-select fields.
3. Create `Estimate` as a number field when estimation mode is `lightweight`.
   Use a small Fibonacci scale (`1, 2, 3, 5, 8, 13`) as relative points. Size child
   tasks or decisions only; omit parent outcome estimates so rollups do not double
   count. A short omission reason is enough when an item is not usefully estimable.
4. Add `Start date`, `Target date`, and an iteration field only when planning needs
   them. The current `gh project field-create` command supports text, number, date,
   and single-select; use the Project UI or an explicitly supported API path for an
   iteration field.
5. Query `gh project field-list ... --format json` and persist canonical display
   names in the binding, never field or option IDs. Resolve live IDs
   immediately before each write and fail closed when a bound name no longer
   exists in the field.

Do not silently replace an existing team's Status semantics. If the required options
are missing, produce an exact setup preview and stop workflow-state writes until the
owner approves field changes.

## Views

- `Delivery board`: board whose column field is Status.
- `Role queues`: table or board grouped by Role.
- `Roadmap`: roadmap using start and target dates or an iteration, with milestone
  markers. If the Project has no scheduling fields, report this view as blocked by
  setup instead of inventing dates.
- `Review & delivery`: filter to In Review, Ready to Deliver, and Delivery Verification.
- `Blocked`: filter `Status: Blocked`.
- `Decisions`: filter the decision issue type or `kind:decision` label.

Keep `Blocked` and `Decisions` separate because GitHub does not support logical OR
filters across different fields. Multiple values of the same field can share one
filter, which is why the review states can coexist in `Review & delivery`.

Saved views are live projections, not copied item lists. After their filters,
grouping, sorting, and visible fields are saved, changes to matching item fields are
reflected automatically. Unsaved personal view changes are not shared. A view does
not itself update item metadata, except deliberate interactions such as dragging an
item between board columns.

Validate all six view definitions operationally before reporting setup complete. If the available GitHub
connector, CLI, or API cannot create or edit a saved view, preserve the exact view
specification and report the UI capability gap; do not claim the view exists.

## Built-in workflows

Use `item added → Ready` only when newly added items are genuinely role-ready;
otherwise default to Refinement. GitHub can synchronize closed Issues and merged PRs
to Done. Treat that automation as a convenience: delivery verification may still
require correcting a premature Done field. Auto-archive retains field values but
removes items from Insights, so archive only after reporting and audit needs are met.

Record each workflow decision as `enabled`, `disabled`, or `preserve` in the setup audit.
Changing a workflow is setup mutation and requires the same direct authority as
changing fields.
