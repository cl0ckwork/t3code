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

## Workspace-scoped provider skills

T3 Code's provider snapshot is global process state, but a repository skill belongs to the active
project checkout or thread worktree. The fork makes those scopes explicit.

### Required behavior

- `.agents/skills` and provider-native workspace skills appear in the composer picker for the
  selected project or worktree. Both `/` and `$` offer the same skill selection UI.
- A global snapshot contains global/user skills only. It must never expose repository skills from
  the server's launch directory to unrelated projects.
- Workspace inventory is resolved from persisted server data: `thread.worktreePath` when present,
  otherwise `project.workspaceRoot`. The client never supplies an arbitrary filesystem path.
- Precedence is `user/global < .agents/skills < .claude/skills`. A picker remains loading while a
  workspace snapshot is being read, even if global skills are already available.
- Codex turns with explicit selected skills re-resolve the names against the current workspace
  immediately before sending. The resulting native skill input is attached to the Codex request;
  visible `$skill` text is not sufficient. A missing, stale, or timed-out skill blocks the send.
- Selected-skill metadata is persisted with the message so old chips still render after a skill is
  renamed or deleted.

### Implementation boundary

Provider snapshots and their workspace variants are owned by the provider registry. The composer
asks for a snapshot for its current Git cwd and renders skills from that result; see
[`ChatComposer.tsx`](../../apps/web/src/components/chat/ChatComposer.tsx) and the shared
`providerSkills` helpers in `packages/client-runtime`.

The final Codex validation boundary is
[`ProviderSkillLookup.ts`](../../apps/server/src/provider/ProviderSkillLookup.ts). It receives
only provider instance, project id, thread id, and skill names; it loads the project and thread,
derives the cwd on the server, applies a deadline, and calls the provider's `snapshotForCwd`.
[`ProviderCommandReactor.ts`](../../apps/server/src/orchestration/Layers/ProviderCommandReactor.ts)
uses that lookup just before it creates a Codex turn. Keep this server-side re-resolution: picker
data is inherently stale by send time.

Codex's global probe filters repository skills in
[`CodexProvider.ts`](../../apps/server/src/provider/Layers/CodexProvider.ts). This prevents a
launch-cwd skill from becoming a global picker entry. Claude performs provider-native filesystem
discovery through the same workspace snapshot route.

Tests to preserve include forged paths, root/worktree selection, collisions, deletion, timeouts,
and the Codex cwd/structured-skill attachment. Test the picker trigger/chip behavior separately.

## Composer skill interaction

Skills are structured inline selections, not text substitutions. The composer accepts both
`/skill-name` and `$skill-name`, displays selected skills as purple chips, supports selecting more
than one skill, and leaves subsequent text as ordinary prompt text. Picker labels use
`Title Case (skill-name): description` so a human-readable name and canonical invocation are both
visible.

The parsing and inline-token contract is shared in
[`composerInlineTokens.ts`](../../packages/shared/src/composerInlineTokens.ts) and
[`composerTrigger.ts`](../../packages/shared/src/composerTrigger.ts). The web editor and command
menu live in [`ComposerPromptEditor.tsx`](../../apps/web/src/components/ComposerPromptEditor.tsx)
and [`ComposerCommandMenu.tsx`](../../apps/web/src/components/chat/ComposerCommandMenu.tsx).
Mobile mirrors the trigger behavior in `apps/mobile/src/features/threads` and its native composer
components.

Preserve both trigger forms as a UI affordance. Provider-native slash commands remain distinct
from skills; do not consume or rewrite a real provider command because its name resembles a skill.

## Thread titles

Thread titles use the project's existing naming language rather than free-form summaries. The
required form is `kind:slug`, for example `work:fix-workspace-skill-picker` or
`spec:DAT-303/retailer-link-gtin-data`. The generator receives recent titles from the same project
as context, plus linked source-control context when it exists. It titles the durable user goal,
not incidental operations such as a plan, test, branch, CI run, or merge.

The prompt contract is in
[`TextGenerationPrompts.ts`](../../apps/server/src/textGeneration/TextGenerationPrompts.ts), and
[`ProviderCommandReactor.ts`](../../apps/server/src/orchestration/Layers/ProviderCommandReactor.ts)
collects project-scoped title context before generation. Keep the initial-title and regeneration
rules aligned. The important regression is a thread changing title to its latest operational
follow-up instead of retaining its original durable subject.

## Sidebar grouping and ordering

The sidebar exposes grouping and ordering controls beside the project scope control. Grouping is a
local client preference with `none`, `workspace`, `project`, `branch`, and `status` choices;
groups can be ordered by recent activity or name. It deliberately is not a generic tag system:
every session has one deterministic value for each grouping mode, so filtering, ordering, and
drag-and-drop retain a clear owner.

The derivation is in [`Sidebar.logic.ts`](../../apps/web/src/components/Sidebar.logic.ts), with
settings types in [`settings.ts`](../../packages/contracts/src/settings.ts). The UI is in
[`Sidebar.tsx`](../../apps/web/src/components/Sidebar.tsx).

Two lifecycle lists are intentional:

- Active/pinned/snoozed sessions are derived and grouped together.
- Settled sessions are derived and grouped separately, with their own settled-time ordering.

Every visible thread must appear exactly once in one of those two lists. Group headers render only
for groups with members in that lifecycle list, and their React keys include the lifecycle section
as well as the group key. Otherwise an unsettle can leave an empty header or active and settled
headers can collide when they share a label.

List-motion is deliberately disabled while grouping is enabled. Its sortable-layout baseline does
not include group headers, so animating a status or worktree transition can leave stale cloned
headers in the DOM. Ungrouped mode keeps the existing row and drag-release animations.

## Pull-request refresh safety

Pull-request polling was disruptive to active review: a detail refresh changed the revision token,
which reset the diff slices, scroll position, selection, and in-progress review state. The fork
keeps return-to-window refreshes, but removes five-minute polling from the pull-request list and
detail panel.

A background detail read may update lightweight PR metadata. If it observes a newer revision, it
does **not** replace the code review; it marks the actions menu with an amber dot and shows one
toast with an explicit Refresh action. The menu also says `Refresh — update available`. Only that
explicit refresh invalidates the host cache and increments the code refresh token.

The mechanism is intentionally local to the detail panel:

- [`useLiveRefresh.ts`](../../apps/web/src/hooks/useLiveRefresh.ts) has a `poll` option. The PR
  list and detail use `poll: false`, retaining focus/visibility reads without an interval.
- [`PullRequestDetailPanel.tsx`](../../apps/web/src/components/pullRequest/PullRequestDetailPanel.tsx)
  records that a new revision came from a background read, preserves the code tab, and owns the
  stale indicator/toast lifecycle.

Do not turn an automatic read into a code refresh. A stale toast is scoped to its PR and closes
when the reader navigates away, so it cannot refresh a different PR later.

## Daily desktop launcher

`vp run desktop:daily` is a production-style local launcher for this fork. It builds the desktop
bundle and starts it against the normal `~/.t3` home so ordinary settings, migrations, and state
match the nightly workflow. It is intentionally separate from `vp run dev`, which keeps a
worktree-local state directory for safe development.

Before using `desktop:daily`, stop the official T3 desktop/server so exactly one server owns the
normal state. Back up `~/.t3/userdata/state.sqlite` before a migration. For isolated testing, use
`vp run dev --home-dir /private/tmp/t3-workspace-skills-state` instead.
