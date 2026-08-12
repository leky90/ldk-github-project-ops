# Software work

Apply these controls only for a software-engineer role.

1. Acquire the local Issue lock and preserve pre-existing user work.
2. Create or safely reuse an Issue-specific branch and linked Git worktree whose
   name contains the Issue number.
3. Capture a clean baseline under ignored `.github-ops/` state.
4. Derive repository-relative scope paths from the Issue and technical resources.
5. Implement and test only the declared deliverable.
6. Stage explicit paths; do not use broad repository staging.
7. Commit, push, and open or update a PR linked with a closing keyword when the
   delivery mode is `software-merge`.
8. Put current SHA, PR, CI, tests, preview, and relevant logs in the handoff.

QA reviews immutable PR and commit evidence, not an engineer's mutable worktree.
QA pass moves software work to `Ready to Deliver`; it does not prove merge. After an
authorized merge, verify merge state, target branch, post-merge checks, and required
smoke evidence. Then remove only disposable clean worktrees/branches. Preserve dirty,
unpushed, uniquely unmerged, and unrelated state and report it.
