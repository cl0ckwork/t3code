import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import {
  type OrchestrationV2ThreadProjection,
  ProjectId,
  type TaskFolder,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ProjectStoreV2 from "../orchestration-v2/ProjectStore.ts";
import * as ProjectionStoreV2 from "../orchestration-v2/ProjectionStore.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";
import * as TaskFolders from "../workspace/TaskFolders.ts";
import * as ReviewService from "./ReviewService.ts";

const threadId = ThreadId.make("review-thread");
const projectId = ProjectId.make("review-project");

const projectionFor = (worktreePath: string | null) =>
  ({ thread: { projectId, worktreePath } }) as unknown as OrchestrationV2ThreadProjection;

const projectFor = (workspaceRoot: string, trackedFolders?: ReadonlyArray<string>) =>
  ({
    workspaceRoot,
    ...(trackedFolders === undefined
      ? {}
      : { trackedFolders: trackedFolders.map((path) => ({ path, name: path })) }),
  }) as unknown as ProjectStoreV2.ProjectRow;

function makeLayer(input: {
  readonly workspaceRoot: string;
  readonly worktreePath: string | null;
  readonly detectCalls?: Array<{ readonly cwd: string }>;
  readonly trackedFolders?: ReadonlyArray<string>;
  readonly taskFolderRoot?: string;
}) {
  return ReviewService.layer.pipe(
    Layer.provide(
      Layer.mock(ProjectionStoreV2.ProjectionStoreV2)({
        getThreadProjection: (requestedThreadId) =>
          requestedThreadId === threadId
            ? Effect.succeed(projectionFor(input.worktreePath))
            : Effect.fail(
                new ProjectionStoreV2.ProjectionStoreThreadNotFoundError({
                  threadId: requestedThreadId,
                }),
              ),
      }),
    ),
    Layer.provide(
      Layer.mock(ProjectStoreV2.ProjectStoreV2)({
        get: () => Effect.succeedSome(projectFor(input.workspaceRoot, input.trackedFolders)),
      }),
    ),
    Layer.provide(
      Layer.mock(TaskFolders.TaskFolders)({
        find: () =>
          Effect.succeed(
            input.taskFolderRoot === undefined
              ? null
              : ({ root: input.taskFolderRoot } as unknown as TaskFolder),
          ),
      }),
    ),
    Layer.provide(
      Layer.mock(VcsDriverRegistry.VcsDriverRegistry)({
        get: () => Effect.die("unexpected VCS registry get"),
        resolve: () => Effect.die("unexpected VCS registry resolve"),
        detect: (request) =>
          Effect.sync(() => {
            input.detectCalls?.push({ cwd: request.cwd });
            return null;
          }),
      }),
    ),
    Layer.provide(Layer.mock(GitVcsDriver.GitVcsDriver)({})),
    Layer.provide(NodeServices.layer),
  );
}

describe("ReviewService", () => {
  it.effect("resolves a preview from the persisted worktree instead of a server cwd", () =>
    Effect.gen(function* () {
      const detectCalls: Array<{ readonly cwd: string }> = [];
      const result = yield* Effect.gen(function* () {
        const review = yield* ReviewService.ReviewService;
        return yield* review.getDiffPreview({ threadId });
      }).pipe(
        Effect.provide(
          makeLayer({
            workspaceRoot: "/projects/pogo-service",
            worktreePath: "/worktrees/pogo-service/feature-diff",
            detectCalls,
          }),
        ),
      );

      assert.strictEqual(result.cwd, "/worktrees/pogo-service/feature-diff");
      assert.deepStrictEqual(result.sources, []);
      assert.deepStrictEqual(detectCalls, [{ cwd: "/worktrees/pogo-service/feature-diff" }]);
    }),
  );

  it.effect("uses the project workspace when the thread has no worktree", () =>
    Effect.gen(function* () {
      const detectCalls: Array<{ readonly cwd: string }> = [];
      const result = yield* Effect.gen(function* () {
        const review = yield* ReviewService.ReviewService;
        return yield* review.getDiffPreview({ threadId });
      }).pipe(
        Effect.provide(
          makeLayer({
            workspaceRoot: "/projects/pogo-service",
            worktreePath: null,
            detectCalls,
          }),
        ),
      );

      assert.strictEqual(result.cwd, "/projects/pogo-service");
      assert.deepStrictEqual(detectCalls, [{ cwd: "/projects/pogo-service" }]);
    }),
  );

  it.effect("rejects a diff request for a missing thread before VCS detection", () =>
    Effect.gen(function* () {
      const detectCalls: Array<{ readonly cwd: string }> = [];
      const error = yield* Effect.gen(function* () {
        const review = yield* ReviewService.ReviewService;
        return yield* review
          .getDiffFileContents({
            threadId: ThreadId.make("missing-thread"),
            sourceKind: "working-tree",
            changeType: "change",
            baseRef: "HEAD",
            headRef: null,
            oldPath: "file.ts",
            newPath: "file.ts",
          })
          .pipe(Effect.flip);
      }).pipe(
        Effect.provide(
          makeLayer({
            workspaceRoot: "/projects/pogo-service",
            worktreePath: null,
            detectCalls,
          }),
        ),
      );

      assert.strictEqual(error._tag, "ReviewWorkspaceUnavailableError");
      if (error._tag === "ReviewWorkspaceUnavailableError") {
        assert.strictEqual(error.reason, "not-found");
      }
      assert.deepStrictEqual(detectCalls, []);
    }),
  );
  it.effect("accepts a selected repository only inside the thread's own folders", () =>
    Effect.gen(function* () {
      const layer = (detectCalls: Array<{ readonly cwd: string }>) =>
        makeLayer({
          workspaceRoot: "/projects/monorepo",
          worktreePath: "/tasks/feature/monorepo",
          trackedFolders: ["/elsewhere/shared-lib"],
          taskFolderRoot: "/tasks/feature",
          detectCalls,
        });
      for (const repositoryCwd of [
        "/tasks/feature/monorepo/packages/sub",
        "/projects/monorepo/vendor/repo",
        "/elsewhere/shared-lib",
        "/tasks/feature/api",
      ]) {
        const detectCalls: Array<{ readonly cwd: string }> = [];
        const result = yield* Effect.gen(function* () {
          const review = yield* ReviewService.ReviewService;
          return yield* review.getDiffPreview({ threadId, repositoryCwd });
        }).pipe(Effect.provide(layer(detectCalls)));
        assert.strictEqual(result.cwd, repositoryCwd);
        assert.deepStrictEqual(detectCalls, [{ cwd: repositoryCwd }]);
      }

      for (const repositoryCwd of ["/tasks/other", "/elsewhere", "/tasks/feature/../other"]) {
        const detectCalls: Array<{ readonly cwd: string }> = [];
        const error = yield* Effect.gen(function* () {
          const review = yield* ReviewService.ReviewService;
          return yield* review.getBranchCommits({ threadId, repositoryCwd }).pipe(Effect.flip);
        }).pipe(Effect.provide(layer(detectCalls)));
        assert.strictEqual(error._tag, "ReviewWorkspaceUnavailableError");
        if (error._tag === "ReviewWorkspaceUnavailableError") {
          assert.strictEqual(error.reason, "outside-workspace");
        }
        assert.deepStrictEqual(detectCalls, []);
      }
    }),
  );
});
