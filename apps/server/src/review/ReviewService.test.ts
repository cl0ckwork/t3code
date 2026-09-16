import { assert, describe, it } from "@effect/vitest";
import { ProjectId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as ProjectionSnapshotQuery from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";
import * as ReviewService from "./ReviewService.ts";

const threadId = ThreadId.make("review-thread");
const projectId = ProjectId.make("review-project");

function makeLayer(input: {
  readonly workspaceRoot: string;
  readonly worktreePath: string | null;
  readonly detectCalls?: Array<{ readonly cwd: string }>;
}) {
  return ReviewService.layer.pipe(
    Layer.provide(
      Layer.mock(ProjectionSnapshotQuery.ProjectionSnapshotQuery)({
        getThreadCheckpointContext: (requestedThreadId) =>
          Effect.succeed(
            requestedThreadId === threadId
              ? Option.some({
                  threadId,
                  projectId,
                  workspaceRoot: input.workspaceRoot,
                  worktreePath: input.worktreePath,
                  checkpoints: [],
                })
              : Option.none(),
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
});
