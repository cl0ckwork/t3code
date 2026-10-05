import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import {
  ReviewWorkspaceUnavailableError,
  VcsUnsupportedOperationError,
  type ReviewDiffFileContentsInput,
  type ReviewDiffFileContentsRequest,
  type ReviewDiffFileContentsResult,
  type ReviewDiffPreviewError,
  type ReviewDiffPreviewInput,
  type ReviewDiffPreviewRequest,
  type ReviewDiffPreviewResult,
} from "@t3tools/contracts";

import * as ProjectStoreV2 from "../orchestration-v2/ProjectStore.ts";
import * as ProjectionStoreV2 from "../orchestration-v2/ProjectionStore.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";

export class ReviewService extends Context.Service<
  ReviewService,
  {
    readonly getDiffPreview: (
      input: ReviewDiffPreviewRequest,
    ) => Effect.Effect<ReviewDiffPreviewResult, ReviewDiffPreviewError>;
    readonly getDiffFileContents: (
      input: ReviewDiffFileContentsRequest,
    ) => Effect.Effect<ReviewDiffFileContentsResult, ReviewDiffPreviewError>;
  }
>()("t3/review/ReviewService") {}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const projectStore = yield* ProjectStoreV2.ProjectStoreV2;
  const projectionStore = yield* ProjectionStoreV2.ProjectionStoreV2;
  const vcsRegistry = yield* VcsDriverRegistry.VcsDriverRegistry;
  const git = yield* GitVcsDriver.GitVcsDriver;

  const resolveThreadWorkspace = Effect.fn("ReviewService.resolveThreadWorkspace")(function* (
    threadId: ReviewDiffPreviewRequest["threadId"],
  ) {
    const projection = yield* projectionStore
      .getThreadProjection(threadId)
      .pipe(
        Effect.mapError((cause) =>
          cause._tag === "ProjectionStoreThreadNotFoundError"
            ? new ReviewWorkspaceUnavailableError({ threadId, reason: "not-found" })
            : new ReviewWorkspaceUnavailableError({ threadId, reason: "unavailable" }),
        ),
      );
    const project = yield* projectStore
      .get(projection.thread.projectId)
      .pipe(
        Effect.mapError(
          () => new ReviewWorkspaceUnavailableError({ threadId, reason: "unavailable" }),
        ),
      );
    if (Option.isNone(project)) {
      return yield* new ReviewWorkspaceUnavailableError({ threadId, reason: "unavailable" });
    }
    return projection.thread.worktreePath ?? project.value.workspaceRoot;
  });

  const getDiffPreview: ReviewService["Service"]["getDiffPreview"] = Effect.fn(
    "ReviewService.getDiffPreview",
  )(function* (input) {
    const cwd = yield* resolveThreadWorkspace(input.threadId);
    const driverInput: ReviewDiffPreviewInput = {
      cwd,
      ...(input.baseRef === undefined ? {} : { baseRef: input.baseRef }),
      ...(input.ignoreWhitespace === undefined ? {} : { ignoreWhitespace: input.ignoreWhitespace }),
      ...(input.file === undefined ? {} : { file: input.file }),
    };

    const handle = yield* vcsRegistry.detect({ cwd, requestedKind: "auto" });
    if (!handle) {
      return {
        cwd,
        generatedAt: yield* DateTime.now,
        sources: [],
      };
    }

    const getDriverDiffPreview = handle.driver.getDiffPreview;
    if (!getDriverDiffPreview) {
      if (handle.kind === "git") {
        return yield* git.getReviewDiffPreview(driverInput);
      }
      return yield* new VcsUnsupportedOperationError({
        operation: "ReviewService.getDiffPreview",
        kind: handle.kind,
        detail: `The ${handle.kind} VCS driver does not support review diff previews.`,
      });
    }

    return yield* getDriverDiffPreview(driverInput);
  });

  const getDiffFileContents: ReviewService["Service"]["getDiffFileContents"] = Effect.fn(
    "ReviewService.getDiffFileContents",
  )(function* (input) {
    const cwd = yield* resolveThreadWorkspace(input.threadId);
    const driverInput: ReviewDiffFileContentsInput = {
      cwd,
      sourceKind: input.sourceKind,
      changeType: input.changeType,
      baseRef: input.baseRef,
      headRef: input.headRef,
      oldPath: input.oldPath,
      newPath: input.newPath,
    };

    const handle = yield* vcsRegistry.detect({ cwd, requestedKind: "auto" });
    if (handle?.kind !== "git") {
      return yield* new VcsUnsupportedOperationError({
        operation: "ReviewService.getDiffFileContents",
        kind: handle?.kind ?? "unknown",
        detail: "Unchanged diff expansion currently requires a Git repository.",
      });
    }

    return yield* git.getReviewDiffFileContents(driverInput);
  });

  return ReviewService.of({
    getDiffPreview,
    getDiffFileContents,
  });
});

export const layer = Layer.effect(ReviewService, make);
