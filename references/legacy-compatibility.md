# Legacy compatibility

Read gen-1 plugin artifacts conservatively — work plans v1-v2 and outcome-typed
handoffs v1 — and write only work plan v4 and handoff v2. Mutation from a legacy
artifact requires a migration preview, no unresolved decisions, an unchanged
source hash, and successful canonical validation.

The project binding stays schemaVersion 1 (owner, projectNumber, repositories,
Projects v2 field and status option ids, roles); it did not change generations.

## Work plan mapping

- `issues[].kind` → `type`; `role` → `ownerRole`; `dor`/`dod` →
  `definitionOfReady`/`definitionOfDone`; `blockedByKeys`/`relatedKeys` →
  `relations.blockedByKeys`/`relations.relatedToKeys`.
- Legacy string `delivery.verification` entries become typed `{mode, check}`
  objects; a string naming another mode's terminal signal stays untyped and
  keeps the plan ineligible until the owner decides.
- A `decision` issue maps to delivery mode `decision` — the issue type itself is
  the certain signal; no text inference is involved.
- Legacy operational sections (`setup`, `estimation`, `views`, `coverage`) are
  not part of the v4 contract; migration reports them as warnings and the
  create-work skill manages fields, views, and workflows operationally instead.
- Missing or `none` priorities become explicit migration decisions; migration
  never defaults them silently.

## Handoff mapping

Outcome-typed handoffs map to v2 events: `handoff` → `handoff`;
`review-passed`/`changes-requested` → `review`; `delivered` → `delivery`;
`verification-passed` → `verification`; `blocked` → `blocked`. Legacy phases map
`artifact-review` → `review` and `terminal` → `complete`. Migrated handoffs lack
`observedState`, typed delivery checks, and recorded review independence, so
they stay preview-only until those are captured live; they remain readable for
reporting history.

## Roles and labels

- `software.change` → owner `software-engineer`, reviewer `qa`.
- `software.review` or an issue already in review → owner `qa`.
- `manager:decision` → owner `cpo`, type `decision`, status `Refinement`.
- `area:product` → `product-manager` unless the issue clearly requests CPO authority.
- `area:marketing` → `marketer`.
- `area:sales` → `sales-representative`.

Do not infer a role when evidence conflicts. Move the issue to `Refinement` or
ask for a decision. Old claim comments are audit history only; never treat an
expired comment as a current lock and never create new machine claim comments.
Never reopen a legacy terminal issue solely because v4 metadata is absent.
