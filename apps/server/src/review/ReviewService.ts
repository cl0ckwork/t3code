import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import {
  ReviewWorkspaceUnavailableError,
  VcsUnsupportedOperationError,
  type ReviewBranchCommitsInput,
  type ReviewBranchCommitsRequest,
  type ReviewBranchCommitsResult,
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
import { isWithinRoot } from "../workspace/KnownWorkspaces.ts";
import * as TaskFolders from "../workspace/TaskFolders.ts";

export class ReviewService extends Context.Service<
  ReviewService,
  {
    readonly getBranchCommits: (
      input: ReviewBranchCommitsRequest,
    ) => Effect.Effect<ReviewBranchCommitsResult, ReviewDiffPreviewError>;
    readonly getDiffPreview: (
      input: ReviewDiffPreviewRequest,
    ) => Effect.Effect<ReviewDiffPreviewResult, ReviewDiffPreviewError>;
    readonly getDiffFileContents: (
      input: ReviewDiffFileContentsRequest,
    ) => Effect.Effect<ReviewDiffFileContentsResult, ReviewDiffPreviewError>;
  }
>()("t3/review/ReviewService") {}

/** @public */
export const make = Effect.gen(function* () {
  const projectStore = yield* ProjectStoreV2.ProjectStoreV2;
  const projectionStore = yield* ProjectionStoreV2.ProjectionStoreV2;
  const vcsRegistry = yield* VcsDriverRegistry.VcsDriverRegistry;
  const git = yield* GitVcsDriver.GitVcsDriver;
  const taskFolders = yield* TaskFolders.TaskFolders;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const realPath = (value: string) =>
    fileSystem.realPath(path.resolve(value)).pipe(Effect.orElseSucceed(() => path.resolve(value)));

  const resolveThreadContext = Effect.fn("ReviewService.resolveThreadContext")(function* (
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
    return {
      workspace: projection.thread.worktreePath ?? project.value.workspaceRoot,
      worktreePath: projection.thread.worktreePath ?? null,
      project: project.value,
    };
  });

  // A multi-repository project lets the client pick a repository, but only one of this thread's:
  // inside its workspace, its project's folders, or its task folder.
  const resolveThreadWorkspace = Effect.fn("ReviewService.resolveThreadWorkspace")(function* (
    threadId: ReviewDiffPreviewRequest["threadId"],
    repositoryCwd?: string,
  ) {
    const context = yield* resolveThreadContext(threadId);
    if (repositoryCwd === undefined) return context.workspace;
    const taskFolder =
      context.worktreePath === null
        ? null
        : yield* taskFolders.find(context.worktreePath).pipe(Effect.orElseSucceed(() => null));
    const roots = [
      context.workspace,
      context.project.workspaceRoot,
      ...(context.project.trackedFolders ?? []).map((folder) => folder.path),
      ...(taskFolder === null ? [] : [taskFolder.root]),
    ];
    const candidate = yield* realPath(repositoryCwd);
    for (const root of roots) {
      if (isWithinRoot(path, candidate, yield* realPath(root))) return path.resolve(repositoryCwd);
    }
    return yield* new ReviewWorkspaceUnavailableError({ threadId, reason: "outside-workspace" });
  });

  const getBranchCommits: ReviewService["Service"]["getBranchCommits"] = Effect.fn(
    "ReviewService.getBranchCommits",
  )(function* (input) {
    const cwd = yield* resolveThreadWorkspace(input.threadId, input.repositoryCwd);
    const driverInput: ReviewBranchCommitsInput = {
      cwd,
      ...(input.baseRef === undefined ? {} : { baseRef: input.baseRef }),
    };

    const handle = yield* vcsRegistry.detect({ cwd, requestedKind: "auto" });
    if (!handle) return { commits: [], truncated: false };
    if (handle.kind !== "git") {
      return yield* new VcsUnsupportedOperationError({
        operation: "ReviewService.getBranchCommits",
        kind: handle.kind,
        detail: "Review commit lists require a Git repository.",
      });
    }
    return yield* git.getReviewBranchCommits(driverInput);
  });

  const getDiffPreview: ReviewService["Service"]["getDiffPreview"] = Effect.fn(
    "ReviewService.getDiffPreview",
  )(function* (input) {
    const cwd = yield* resolveThreadWorkspace(input.threadId, input.repositoryCwd);
    const driverInput: ReviewDiffPreviewInput = {
      cwd,
      ...(input.baseRef === undefined ? {} : { baseRef: input.baseRef }),
      ...(input.mergeBase === undefined ? {} : { mergeBase: input.mergeBase }),
      ...(input.commitSha === undefined ? {} : { commitSha: input.commitSha }),
      ...(input.ignoreWhitespace === undefined ? {} : { ignoreWhitespace: input.ignoreWhitespace }),
      ...(input.sourceKind === undefined ? {} : { sourceKind: input.sourceKind }),
      ...(input.trackedOnly === undefined ? {} : { trackedOnly: input.trackedOnly }),
      ...(input.completionToken === undefined ? {} : { completionToken: input.completionToken }),
      ...(input.metadataOnly === undefined ? {} : { metadataOnly: input.metadataOnly }),
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

    return yield* git.getReviewDiffPreview(driverInput);
  });

  const getDiffFileContents: ReviewService["Service"]["getDiffFileContents"] = Effect.fn(
    "ReviewService.getDiffFileContents",
  )(function* (input) {
    const cwd = yield* resolveThreadWorkspace(input.threadId, input.repositoryCwd);
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
    getBranchCommits,
    getDiffPreview,
    getDiffFileContents,
  });
});

export const layer = Layer.effect(ReviewService, make);
