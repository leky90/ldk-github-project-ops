# Role-based work model

One Issue is one role-owned work packet. Its human contract contains one outcome,
one current deliverable, one current role, optional reviewer role, DoR, role-phase
DoD, acceptance criteria, linked resources, native dependencies, and a delivery
contract.

## Project item states

- `Refinement`: missing scope, decision, role, resource, or DoR.
- `Ready`: current role can start and no dependency is open.
- `In Progress`: active work has begun.
- `In Review`: deliverable and evidence are with the reviewer role.
- `Ready to Deliver`: review passed; authorized merge/publish/action remains.
- `Delivery Verification`: terminal action happened; outcome is being verified.
- `Blocked`: execution stopped with owner and resume condition.
- `Done`: declared delivery mode has terminal evidence.
- `Canceled`: intentionally abandoned or superseded.

The Project `Status` field and Issue open/closed state are separate. Normally close
an Issue as completed only after the item reaches `Done`; closing as not planned maps
to `Canceled`. Built-in Project workflows may synchronize them, so always re-read
both after a mutation.

On changes requested, return to `Ready` and restore the delivering role. Do not
leave an item `In Progress` when nobody owns an active phase.

## Common handoffs

- CPO → Tech Lead: brief/PRD becomes a technical breakdown request.
- Tech Lead → Software Engineer: scoped implementation Issue and QA-ready DoD.
- Software Engineer → QA: current commit, PR, test, and CI evidence.
- QA → terminal owner: `Ready to Deliver` when merge or release remains.
- Content Director → Content Writer → Content Director.
- Marketing Lead → Marketer → Marketing Lead.
- Sales Manager → Sales Representative → Sales Manager.

The same host may assume different roles in different runs, but one run performs
only the role currently requested by the Issue.
