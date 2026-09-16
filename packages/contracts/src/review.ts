import * as Schema from "effect/Schema";
import { ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { GitCommandError } from "./git.ts";
import { VcsError } from "./vcs.ts";

/**
 * Client request for a live diff. The server resolves the workspace from the
 * persisted thread instead of trusting a client-supplied filesystem path.
 */
export const ReviewDiffPreviewRequest = Schema.Struct({
  threadId: ThreadId,
  baseRef: Schema.optional(TrimmedNonEmptyString),
  ignoreWhitespace: Schema.optionalKey(Schema.Boolean),
});
export type ReviewDiffPreviewRequest = typeof ReviewDiffPreviewRequest.Type;

/** VCS-internal input after the server has resolved the thread workspace. */
export const ReviewDiffPreviewInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  baseRef: Schema.optional(TrimmedNonEmptyString),
  ignoreWhitespace: Schema.optionalKey(Schema.Boolean),
  file: Schema.optionalKey(
    Schema.Struct({
      path: Schema.NonEmptyString,
      previousPath: Schema.NullOr(Schema.NonEmptyString),
      sourceKind: Schema.Literals(["working-tree", "branch-range"]),
    }),
  ),
});
export type ReviewDiffPreviewInput = typeof ReviewDiffPreviewInput.Type;

export const ReviewDiffPreviewSourceKind = Schema.Literals(["working-tree", "branch-range"]);
export type ReviewDiffPreviewSourceKind = typeof ReviewDiffPreviewSourceKind.Type;

export const ReviewDiffFileStat = Schema.Struct({
  path: Schema.String,
  previousPath: Schema.NullOr(Schema.String),
  additions: Schema.Number,
  deletions: Schema.Number,
});
export type ReviewDiffFileStat = typeof ReviewDiffFileStat.Type;

export const ReviewDiffPreviewSource = Schema.Struct({
  id: TrimmedNonEmptyString,
  kind: ReviewDiffPreviewSourceKind,
  title: TrimmedNonEmptyString,
  baseRef: Schema.NullOr(TrimmedNonEmptyString),
  headRef: Schema.NullOr(TrimmedNonEmptyString),
  diff: Schema.String,
  diffHash: TrimmedNonEmptyString,
  truncated: Schema.Boolean,
  /** Complete statistics, independent of patch limits. Absent on older servers. */
  files: Schema.optionalKey(Schema.Array(ReviewDiffFileStat)),
});
export type ReviewDiffPreviewSource = typeof ReviewDiffPreviewSource.Type;

/** Client request to expand a file in a live diff. */
export const ReviewDiffFileContentsRequest = Schema.Struct({
  threadId: ThreadId,
  sourceKind: ReviewDiffPreviewSourceKind,
  changeType: Schema.Literals(["change", "rename-pure", "rename-changed", "new", "deleted"]),
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
  changeType: Schema.Literals(["change", "rename-pure", "rename-changed", "new", "deleted"]),
  baseRef: Schema.NullOr(TrimmedNonEmptyString),
  headRef: Schema.NullOr(TrimmedNonEmptyString),
  oldPath: TrimmedNonEmptyString,
  newPath: TrimmedNonEmptyString,
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
});
export type ReviewDiffPreviewResult = typeof ReviewDiffPreviewResult.Type;

export class ReviewWorkspaceUnavailableError extends Schema.TaggedError<ReviewWorkspaceUnavailableError>()(
  "ReviewWorkspaceUnavailableError",
  {
    threadId: ThreadId,
    reason: Schema.Literals(["not-found", "unavailable"]),
  },
) {
  override get message(): string {
    return this.reason === "not-found"
      ? `Cannot load a diff because thread '${this.threadId}' no longer exists.`
      : `Cannot resolve the workspace for thread '${this.threadId}'.`;
  }
}

export const ReviewDiffPreviewError = Schema.Union([
  VcsError,
  GitCommandError,
  ReviewWorkspaceUnavailableError,
]);
export type ReviewDiffPreviewError = typeof ReviewDiffPreviewError.Type;
