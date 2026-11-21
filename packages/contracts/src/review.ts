import * as Schema from "effect/Schema";
import { ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { GitCommandError } from "./git.ts";
import { VcsError } from "./vcs.ts";

// An object id or HEAD, never an option-looking ref, since it is passed to git as a revision.
const ReviewMergeBase = Schema.String.check(
  Schema.isPattern(/^(?:[0-9a-f]{40}|[0-9a-f]{64}|HEAD)$/),
);

export const ReviewDiffPreviewSourceKind = Schema.Literals([
  "working-tree",
  "branch-range",
  "commit",
]);
export type ReviewDiffPreviewSourceKind = typeof ReviewDiffPreviewSourceKind.Type;

/**
 * Client request for a live diff. The server resolves the workspace from the
 * persisted thread instead of trusting a client-supplied filesystem path.
 */
export const ReviewDiffPreviewFile = Schema.Struct({
  path: Schema.NonEmptyString,
  previousPath: Schema.NullOr(Schema.NonEmptyString),
  sourceKind: ReviewDiffPreviewSourceKind,
});
export type ReviewDiffPreviewFile = typeof ReviewDiffPreviewFile.Type;

export const ReviewDiffPreviewRequest = Schema.Struct({
  threadId: ThreadId,
  /**
   * One of the thread's repositories, for a project that covers several. The server accepts it
   * only inside the thread's workspace, its project's folders, or its task folder.
   */
  repositoryCwd: Schema.optionalKey(TrimmedNonEmptyString),
  baseRef: Schema.optional(TrimmedNonEmptyString),
  mergeBase: Schema.optionalKey(ReviewMergeBase),
  commitSha: Schema.optional(TrimmedNonEmptyString),
  ignoreWhitespace: Schema.optionalKey(Schema.Boolean),
  sourceKind: Schema.optionalKey(Schema.Literals(["working-tree", "branch-range"])),
  trackedOnly: Schema.optionalKey(Schema.Boolean),
  completionToken: Schema.optionalKey(Schema.String),
  metadataOnly: Schema.optionalKey(Schema.Boolean),
  file: Schema.optionalKey(ReviewDiffPreviewFile),
});
export type ReviewDiffPreviewRequest = typeof ReviewDiffPreviewRequest.Type;

/** VCS-internal input after the server has resolved the thread workspace. */
export const ReviewDiffPreviewInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  baseRef: Schema.optional(TrimmedNonEmptyString),
  // A branch-range file read reuses its preview's merge base instead of resolving it again.
  mergeBase: Schema.optionalKey(ReviewMergeBase),
  commitSha: Schema.optional(TrimmedNonEmptyString),
  ignoreWhitespace: Schema.optionalKey(Schema.Boolean),
  sourceKind: Schema.optionalKey(Schema.Literals(["working-tree", "branch-range"])),
  trackedOnly: Schema.optionalKey(Schema.Boolean),
  /** From a trackedOnly result, so the complete read adds only the untracked files. */
  completionToken: Schema.optionalKey(Schema.String),
  metadataOnly: Schema.optionalKey(Schema.Boolean),
  file: Schema.optionalKey(ReviewDiffPreviewFile),
});
export type ReviewDiffPreviewInput = typeof ReviewDiffPreviewInput.Type;

/** Client request for the thread workspace's branch commits. */
export const ReviewBranchCommitsRequest = Schema.Struct({
  threadId: ThreadId,
  repositoryCwd: Schema.optionalKey(TrimmedNonEmptyString),
  baseRef: Schema.optional(TrimmedNonEmptyString),
});
export type ReviewBranchCommitsRequest = typeof ReviewBranchCommitsRequest.Type;

/** VCS-internal input after the server has resolved the thread workspace. */
export const ReviewBranchCommitsInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  baseRef: Schema.optional(TrimmedNonEmptyString),
});
export type ReviewBranchCommitsInput = typeof ReviewBranchCommitsInput.Type;

export const ReviewBranchCommitsResult = Schema.Struct({
  commits: Schema.Array(
    Schema.Struct({
      sha: Schema.String,
      subject: Schema.String,
      committedAt: Schema.String,
    }),
  ),
  truncated: Schema.Boolean,
});
export type ReviewBranchCommitsResult = typeof ReviewBranchCommitsResult.Type;

export const ReviewDiffChangeType = Schema.Literals([
  "change",
  "rename-pure",
  "rename-changed",
  "new",
  "deleted",
]);
export type ReviewDiffChangeType = typeof ReviewDiffChangeType.Type;

export const ReviewDiffFileStat = Schema.Struct({
  path: Schema.String,
  previousPath: Schema.NullOr(Schema.String),
  // Older servers omit it.
  changeType: Schema.optionalKey(ReviewDiffChangeType),
  additions: Schema.Number,
  deletions: Schema.Number,
});
export type ReviewDiffFileStat = typeof ReviewDiffFileStat.Type;

export const ReviewDiffPreviewSource = Schema.Struct({
  id: TrimmedNonEmptyString,
  kind: ReviewDiffPreviewSourceKind,
  title: TrimmedNonEmptyString,
  commitSubject: Schema.optionalKey(TrimmedNonEmptyString),
  baseRef: Schema.NullOr(TrimmedNonEmptyString),
  headRef: Schema.NullOr(TrimmedNonEmptyString),
  // Branch-range only; older servers omit it.
  mergeBase: Schema.optionalKey(ReviewMergeBase),
  diff: Schema.String,
  diffHash: TrimmedNonEmptyString,
  truncated: Schema.Boolean,
  patchesDeferred: Schema.optionalKey(Schema.Boolean),
  files: Schema.optionalKey(Schema.Array(ReviewDiffFileStat)),
});
export type ReviewDiffPreviewSource = typeof ReviewDiffPreviewSource.Type;

/** Client request to expand a file in a live diff. */
export const ReviewDiffFileContentsRequest = Schema.Struct({
  threadId: ThreadId,
  repositoryCwd: Schema.optionalKey(TrimmedNonEmptyString),
  sourceKind: ReviewDiffPreviewSourceKind,
  changeType: ReviewDiffChangeType,
  baseRef: Schema.NullOr(TrimmedNonEmptyString),
  headRef: Schema.NullOr(TrimmedNonEmptyString),
  oldPath: TrimmedNonEmptyString,
  newPath: TrimmedNonEmptyString,
});
export type ReviewDiffFileContentsRequest = typeof ReviewDiffFileContentsRequest.Type;

/** VCS-internal input after the server has resolved the thread workspace. */
export const ReviewDiffFileContentsInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  sourceKind: ReviewDiffPreviewSourceKind,
  changeType: ReviewDiffChangeType,
  baseRef: Schema.NullOr(TrimmedNonEmptyString),
  headRef: Schema.NullOr(TrimmedNonEmptyString),
  oldPath: Schema.NonEmptyString,
  newPath: Schema.NonEmptyString,
});
export type ReviewDiffFileContentsInput = typeof ReviewDiffFileContentsInput.Type;

export const ReviewDiffFileContentsResult = Schema.Struct({
  oldContents: Schema.String,
  newContents: Schema.String,
});
export type ReviewDiffFileContentsResult = typeof ReviewDiffFileContentsResult.Type;

export const ReviewDiffPreviewResult = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  generatedAt: Schema.DateTimeUtc,
  sources: Schema.Array(ReviewDiffPreviewSource),
  incomplete: Schema.optionalKey(Schema.Boolean),
  completionToken: Schema.optionalKey(Schema.String),
});
export type ReviewDiffPreviewResult = typeof ReviewDiffPreviewResult.Type;

export class ReviewWorkspaceUnavailableError extends Schema.TaggedError<ReviewWorkspaceUnavailableError>()(
  "ReviewWorkspaceUnavailableError",
  {
    threadId: ThreadId,
    reason: Schema.Literals(["not-found", "unavailable", "outside-workspace"]),
  },
) {
  override get message(): string {
    switch (this.reason) {
      case "not-found":
        return `Cannot load a diff because thread '${this.threadId}' no longer exists.`;
      case "outside-workspace":
        return `Cannot load a diff outside the repositories of thread '${this.threadId}'.`;
      default:
        return `Cannot resolve the workspace for thread '${this.threadId}'.`;
    }
  }
}

export const ReviewDiffPreviewError = Schema.Union([
  VcsError,
  GitCommandError,
  ReviewWorkspaceUnavailableError,
]);
export type ReviewDiffPreviewError = typeof ReviewDiffPreviewError.Type;
