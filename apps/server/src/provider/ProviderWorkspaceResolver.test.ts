import { assert, describe, it } from "@effect/vitest";
import { type OrchestrationV2ThreadProjection, ProjectId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import { resolveProviderWorkspace } from "./ProviderWorkspaceResolver.ts";

const projectId = ProjectId.make("project-1");
const otherProjectId = ProjectId.make("project-2");
const threadId = ThreadId.make("thread-1");

const project = { workspaceRoot: "/projects/pogo" } as ProjectStore.ProjectRow;
const projection = (input: {
  readonly projectId: ProjectId;
  readonly worktreePath: string | null;
}) => ({ thread: input }) as unknown as OrchestrationV2ThreadProjection;

const layer = (input: {
  readonly project?: ProjectStore.ProjectRow;
  readonly thread?: OrchestrationV2ThreadProjection;
}) =>
  Layer.mergeAll(
    Layer.mock(ProjectStore.ProjectStoreV2)({
      get: () =>
        input.project === undefined ? Effect.succeedNone : Effect.succeedSome(input.project),
    }),
    Layer.mock(ProjectionStore.ProjectionStoreV2)({
      getThreadProjection: () =>
        input.thread
          ? Effect.succeed(input.thread)
          : Effect.fail(new ProjectionStore.ProjectionStoreThreadNotFoundError({ threadId })),
    }),
  );

describe("ProviderWorkspaceResolver", () => {
  it.effect("uses the persisted worktree for a thread-scoped scan", () =>
    Effect.gen(function* () {
      const cwd = yield* resolveProviderWorkspace({
        instanceId: "codex" as never,
        projectId,
        threadId,
      }).pipe(
        Effect.provide(
          layer({
            project,
            thread: projection({ projectId, worktreePath: "/worktrees/pogo/feature" }),
          }),
        ),
      );
      assert.strictEqual(cwd, "/worktrees/pogo/feature");
    }),
  );

  it.effect("rejects a thread from another project", () =>
    Effect.gen(function* () {
      const error = yield* resolveProviderWorkspace({
        instanceId: "codex" as never,
        projectId,
        threadId,
      }).pipe(
        Effect.flip,
        Effect.provide(
          layer({
            project,
            thread: projection({ projectId: otherProjectId, worktreePath: "/forged" }),
          }),
        ),
      );
      assert.strictEqual(error._tag, "ProviderSetupError");
      assert.strictEqual(error.operation, "refresh-workspace");
    }),
  );
});
