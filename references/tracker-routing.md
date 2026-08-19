# GitHub and Linear tracker routing

`ldk-github-project-ops` and `ldk-linear-project-ops` may be installed together and
may both be bound in one repository. Their objects remain independent; neither
plugin mirrors or silently migrates work to the other tracker.

Route each prompt before reading or mutating tracker data:

1. An explicit tracker name, URL, CLI command, or native identifier wins.
   `github.com`, `GitHub Project`, `gh project`, `owner/repo#123`, and a bare `#123`
   with explicit GitHub context route to GitHub. `linear.app`, `Linear`, and
   identifiers such as `ABC-123` route to Linear.
2. If only one valid repository binding exists, a generic project-operations prompt
   may use that tracker.
3. If both bindings exist and the prompt is generic, stop before tracker reads or
   writes and ask the owner to name GitHub or Linear. Do not let both create-work
   skills run.
4. If a prompt names both trackers, treat it as a cross-tracker request. Require an
   explicit source, destination, mapping, and write scope; otherwise remain
   read-only and report the ambiguity.
5. Stale conversation memory, similarly named projects, and the current working
   directory are never sufficient to switch trackers.

The host hooks implement the same arbitration for common project-operation prompts.
When both plugins are bound, the GitHub hook emits the single shared ambiguity notice
and the Linear hook suppresses its duplicate. Skills must still enforce the boundary
because hooks are advisory and are not background daemons.
