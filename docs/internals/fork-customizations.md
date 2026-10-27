# Fork customizations

This fork is used as a daily build while it follows `upstream/main`. This document records the
intentional product differences so a rebase can preserve their behavior, replace them with an
equivalent upstream feature, or remove them deliberately. It is not a changelog.

## Rebase rule

Compare **invariants**, not files or commit hashes. Upstream may move an implementation across the
server, contracts, client runtime, web, and mobile. A fork change can be dropped only when the
upstream version provides the same observable behavior and maintains the same safety boundary.

After a rebase, start with focused tests beside the changed behavior, then exercise the affected
UI manually. Use two projects or worktrees for workspace-scoped behavior; a one-project smoke test
cannot reveal cross-project leakage.

## Thread-scoped live diffs

Live working-tree and branch diffs belong to the thread's workspace, not the T3 server's launch
directory. This fixes the external-worktree failure tracked upstream in
[#4022](https://github.com/pingdotgg/t3code/issues/4022): the old review API accepted a client
`cwd`, rejected valid project worktrees outside the server root, then the web client silently
retried against the server cwd and rendered an unrelated or empty diff.

The review RPC now accepts only a `threadId`. [`ReviewService.ts`](../../apps/server/src/review/ReviewService.ts)
uses persisted projection data to resolve `thread.worktreePath ?? project.workspaceRoot`; the
VCS receives that derived path only after resolution. Preview requests and lazy full-file
expansion share this boundary. Web and mobile send the selected thread id, and the web diff panel
does not contain a fallback query against the server cwd.

Keep these invariants on rebase:

- A client cannot choose an arbitrary filesystem path for live-diff preview or expansion.
- An active worktree thread reads its own worktree; an in-place thread reads its project root.
- A missing or unreadable thread returns a typed workspace error. It must not silently diff a
  different repository.

### Mixed-version environments

The fork's review-diff and workspace-skill RPCs deliberately replace client `cwd` with persisted
thread/project context. A newer client connected through T3 Connect to an older host must never
fall back to sending a path just to regain that feature.

`threadScopedReviewDiffs` and `workspaceProviderSkills` are environment capabilities. A client
issues the thread/project-scoped requests only when the connected host advertises the matching
capability. Otherwise it keeps the safety boundary and explains that the host needs an update;
it does not make an unrelated live-diff request or scan the launch directory.

## Workspace-scoped provider skills

T3 Code's provider snapshot is global process state, but a repository skill belongs to the active
project checkout or thread worktree. The fork makes those scopes explicit.

### Upstream ownership and fork boundary

Upstream owns normal provider discovery, the unified `/` and `$` picker, picker deduplication,
workspace-snapshot freshness, and Claude's native selected-skill execution. Do not reintroduce a
second skill inventory or a client-side cache to duplicate those mechanisms.

The fork deliberately keeps only the parts upstream does not yet provide equivalently:

- workspace selection is derived on the server from persisted project/thread state rather than a
  client-provided path;
- `/` may select another skill after an existing selection, as may `$`;
- inline Markdown code and fenced code remain literal;
- Codex selected skills are validated at dispatch and sent as native structured inputs.

### Required behavior

- Provider-native workspace skills appear in the composer picker for the selected project or
  worktree. Both `/` and `$` offer the same skill selection UI. Claude currently exposes its
  native user and `.claude/skills` locations; do not claim `.agents/skills` support for Claude
  without an execution bridge, because a picker entry alone would not load that skill at runtime.
- A global snapshot contains global/user skills only. It must never expose repository skills from
  the server's launch directory to unrelated projects.
- Workspace inventory is resolved from persisted server data: `thread.worktreePath` when present,
  otherwise `project.workspaceRoot`. The client never supplies an arbitrary filesystem path.
- Provider-native discovery determines collision precedence. A picker remains loading while a
  workspace snapshot is being read, even if global skills are already available; presentation
  order must not disagree with the provider that executes the selected skill.
- Codex turns with explicit selected skills re-resolve the names against the current workspace
  immediately before sending or steering. The resulting native `{ type: "skill", name, path }`
  input is attached to the Codex request; visible `$skill` text is not sufficient. A missing,
  stale, disabled, or timed-out skill blocks the dispatch.
- Historical chips currently resolve against live inventory. Do not promise them to survive a
  rename or deletion until selected-skill metadata is made durable with the message.

### Implementation boundary

Provider snapshots and their workspace variants are owned by the provider registry. The composer
identifies the provider instance plus its persisted project and optional thread; the refresh RPC in
[`ws.ts`](../../apps/server/src/ws.ts) resolves `thread.worktreePath ?? project.workspaceRoot`
before it calls the registry. `cwd` is deliberately not part of the RPC contract. The registry
then caches the provider-specific result by instance and resolved workspace path, while the
composer renders the matching workspace snapshot through the shared `providerSkills` helpers.
Upstream's shared refresh atom family in
[`providerSkills.ts`](../../packages/client-runtime/src/providerSkills.ts) is keyed by project and
thread here, and an on-demand refresh reply carries only the snapshot for the server-resolved path;
the client records it under that reply's `cwd`, never a path it sent.

This is a trust boundary, not a client-side convenience. A thread must belong to the supplied
project, a deleted project or thread fails the refresh, and a forged path cannot cause the server
to scan another directory. Provider adapters remain responsible for native structured skill input
at dispatch time; visible `$skill` text alone is never an attachment contract. For Codex, the
adapter calls `skills/list` with the runtime workspace and `forceReload: true`, then appends one
native skill input for each unique selected skill to `turn/start` or `turn/steer`. When a workspace
cwd was requested, Codex must return that exact workspace entry; never fall back to a same-named
skill discovered for another cwd.

Tests to preserve include forged paths, root/worktree selection, collisions, deletion, timeouts,
and the Codex cwd/structured-skill attachment. Test the picker trigger/chip behavior separately.

## Composer skill interaction

Skills are structured inline selections, not text substitutions. The composer accepts both
`/skill-name` and `$skill-name`, displays selected skills as purple chips, supports selecting more
than one skill, and leaves subsequent text as ordinary prompt text. Picker labels use
`Title Case (skill-name): description` so a human-readable name and canonical invocation are both
visible. Markdown inline code and fenced code blocks are always literal, so snippets such as
`$eq` cannot become skill selections or reach send-time skill validation. Upstream's rich editor
now keeps fenced code literal by itself; the fork still owns inline code, trigger suppression
inside code, `/skill` chips, and the same rule in Claude dispatch.

The parsing and inline-token contract is shared in
[`composerInlineTokens.ts`](../../packages/shared/src/composerInlineTokens.ts) and
[`composerTrigger.ts`](../../packages/shared/src/composerTrigger.ts). The web editor and command
menu live in [`ComposerPromptEditor.tsx`](../../apps/web/src/components/ComposerPromptEditor.tsx)
and [`ComposerCommandMenu.tsx`](../../apps/web/src/components/chat/ComposerCommandMenu.tsx).
Mobile mirrors the trigger behavior in `apps/mobile/src/features/threads` and its native composer
components.

Preserve both trigger forms as a UI affordance. Provider-native slash commands remain distinct
from skills; do not consume or rewrite a real provider command because its name resembles a skill.

## Context and thread usage

The upstream `contextWindowMeterEnabled` preference controls whether the composer meter is shown.
When enabled, it distinguishes live native context occupancy from accounting that merely describes
the most recent provider response. This is essential for Codex: its app server reports the latest
request's token total and model window, but not the transcript size after automatic compaction.

[`CodexAdapterV2.ts`](../../apps/server/src/orchestration-v2/Adapters/CodexAdapterV2.ts) marks
that report with `contextUsageAvailable: false`. The contract in
[`providerRuntime.ts`](../../packages/contracts/src/providerRuntime.ts) carries the distinction to
the web client. [`ContextWindowMeter.tsx`](../../apps/web/src/components/chat/ContextWindowMeter.tsx)
then shows **Last request context** rather than a fake percentage, remaining-token count, or
automatic compact recommendation. Actual live reports from providers that support them retain the
normal context-window progress UI.

Never use an estimate as capacity data. [`ContextHandoffBudget.ts`](../../apps/server/src/orchestration-v2/ContextHandoffBudget.ts)
excludes estimate-only reports from history handoff and model-switch calculations, and the resume
compact banner appears only for live context telemetry. The useful invariant is: no UI or
orchestration decision may imply that a last-response token count is the current native context.

## Sidebar grouping and ordering

The sidebar exposes grouping and ordering controls beside the project scope control. Grouping is a
local client preference with `none`, `workspace`, `project`, `branch`, and `status` choices;
groups can be ordered by recent activity or name. It deliberately is not a generic tag system:
every session has one deterministic value for each grouping mode, so filtering, ordering, and
drag-and-drop retain a clear owner.

The derivation is in [`Sidebar.logic.ts`](../../apps/web/src/components/Sidebar.logic.ts), with
settings types in [`settings.ts`](../../packages/contracts/src/settings.ts). The UI is in
[`Sidebar.tsx`](../../apps/web/src/components/Sidebar.tsx).

Workspace grouping is keyed by the persisted full worktree path, never its display label. Its label
prefers one unambiguous, non-temporary branch reported by the threads in that workspace, falling
back to the directory basename while branch creation is still pending or thread metadata conflicts.
Do not rename a live worktree merely to improve this label: Git, persisted thread state, and a
running provider may all hold its path.

Upstream lifecycle shelves stay structurally above grouping:

- **Pinned**, **Working**, and **Snoozed** preserve their own membership, controls, counts, and
  collapse behavior. A grouping never moves their rows into another shelf.
- Grouping applies within ordinary **Active** rows and separately within **Settled** rows. Settled
  retains its own shelf and settled-time ordering.

Every visible thread must appear exactly once in exactly one shelf. Group headers render only for
groups with members in that shelf, and their React keys include the shelf as well as the group key.
Otherwise an unsettle can leave an empty header or two shelves can collide when they share a label.

Group order by recent activity uses the most recent thread activity in each group, not insertion
order. Drag/reorder and sweep interactions are disabled while grouping is enabled: their canonical
sortable layout has no group headers, so letting it operate against grouped DOM can apply a drop to
a different row. Ungrouped mode keeps the existing row and drag-release interactions.

## Project action lifecycle hooks

Project actions can be invoked manually, on worktree creation, or after a thread settles. The
settlement trigger applies to both user-initiated and automatic settlement, but exactly once per
real active-to-settled transition. Repeating Settle on an already settled thread must not launch a
second cleanup action; an explicit unsettle followed by a later settle is a new transition and may
launch it again.

Upstream's `runOnSettle` is a different, worktree-only cleanup role. If a script has that role,
the upstream cleanup runner owns it and the generic `thread.settled` outbox must skip it. The roles
are mutually exclusive so one command cannot run twice for one settlement.

The trigger is stored in [`ProjectScript`](../../packages/contracts/src/project.ts) as an extensible
`lifecycleTriggers` list. The action editor exposes the current `thread.settled` trigger, imports it
from `t3.json`, and shows `on settle` in the actions list. More lifecycle events can use the same
contract without adding another action type.

The execution boundary is deliberately durable and worktree-only. [`Orchestrator.ts`](../../apps/server/src/orchestration-v2/Orchestrator.ts)
captures the chosen action and isolated worktree path in the outbox item that commits with the
settlement event; root-checkout threads do not enqueue a generic lifecycle action. Before starting
the action, [`EffectWorker.ts`](../../apps/server/src/orchestration-v2/EffectWorker.ts) re-reads
the projection and no-ops when the thread has been re-engaged. Never accept a client cwd or
re-resolve a later action configuration at execution time.

The lifecycle effect is not replay-safe after process loss. Once the worker has started a shell,
replaying could run external cleanup twice. A normal terminal-start failure remains retryable and
visible through the outbox; an interrupted in-flight hook is cancelled instead of silently
duplicating it.

## Pull-request refresh safety

Pull-request polling was disruptive to active review: a detail refresh changed the revision token,
which reset the diff slices, scroll position, selection, and in-progress review state. The fork
keeps return-to-window refreshes, but removes five-minute polling from the pull-request list and
detail panel.

A background detail read may update lightweight PR metadata. If it observes a newer revision, it
does **not** replace the code review; it marks the actions menu with an amber dot and shows one
toast with an explicit Refresh action. The menu also says `Refresh (update available)`. Only that
explicit refresh invalidates the host cache and increments the code refresh token.

The mechanism is intentionally local to the detail panel:

- The PR list and detail pass upstream's `intervalMs: null` to
  [`useLiveRefresh.ts`](../../apps/web/src/hooks/useLiveRefresh.ts), retaining focus/visibility
  reads without an interval.
- [`PullRequestDetailPanel.tsx`](../../apps/web/src/components/pullRequest/PullRequestDetailPanel.tsx)
  records that a new revision came from a background read, preserves the code tab, and owns the
  stale state and toast lifecycle. It passes `codeIsStale` to
  [`PullRequestActionsMenu.tsx`](../../apps/web/src/components/pullRequest/PullRequestActionsMenu.tsx),
  which renders the amber dot and the `Refresh (update available)` label.

Do not turn an automatic read into a code refresh. A stale toast is scoped to its PR and closes
when the reader navigates away, so it cannot refresh a different PR later.

## Agent orchestration instructions

[`orchestrationInstructions.ts`](../../packages/provider-core/src/server/orchestrationInstructions.ts)
adds two lines to upstream's injected agent instructions. Upstream tells agents that ordinary
coding needs no T3 tools and shows visuals only when asked. The fork also tells agents to use T3
tools when they are the product-native way to do the work or help the user decide, and to show a
chart, table, diagram, pseudocode, or mockup unasked when it says more than prose. Keep each
section below Codex's 4,000-byte entry limit. Drop these lines if upstream adopts equivalent
proactive guidance.

## Daily desktop launcher

`vp run desktop:daily` is a production-style local launcher for this fork. It builds the desktop
bundle and starts it against the normal `~/.t3` home so ordinary settings, migrations, and state
match the nightly workflow. It is intentionally separate from `vp run dev`, which keeps a
worktree-local state directory for safe development.

Before using `desktop:daily`, stop the official T3 desktop/server so exactly one server owns the
normal state. Back up `~/.t3/userdata/state.sqlite` before a migration. For isolated testing, use
`vp run dev --home-dir /private/tmp/t3-workspace-skills-state` instead.
