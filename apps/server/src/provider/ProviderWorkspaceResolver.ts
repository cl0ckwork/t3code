import {
  type ProjectId,
  ProviderSetupError,
  type ProviderInstanceId,
  type ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";

/**
 * Resolves a provider discovery workspace from durable application state.
 * Callers deliberately receive a path only after proving the requested thread
 * belongs to the requested project; client paths are never part of this API.
 */
export const resolveProviderWorkspace = Effect.fn("ProviderWorkspaceResolver.resolve")(
  function* (input: {
    readonly instanceId: ProviderInstanceId;
    readonly projectId: ProjectId;
    readonly threadId?: ThreadId | undefined;
  }) {
    const projects = yield* ProjectStore.ProjectStoreV2;
    const unavailable = (detail: string) =>
      new ProviderSetupError({
        instanceId: input.instanceId,
        operation: "refresh-workspace",
        detail,
      });
    const project = yield* projects
      .get(input.projectId)
      .pipe(Effect.mapError(() => unavailable("Could not resolve the selected project.")));
    if (Option.isNone(project)) {
      return yield* unavailable("The selected project no longer exists.");
    }
    if (input.threadId === undefined) return project.value.workspaceRoot;

    const projections = yield* ProjectionStore.ProjectionStoreV2;
    const projection = yield* projections
      .getThreadProjection(input.threadId)
      .pipe(Effect.mapError(() => unavailable("Could not resolve the selected thread.")));
    if (projection.thread.projectId !== input.projectId) {
      return yield* unavailable("The selected thread does not belong to the selected project.");
    }
    return projection.thread.worktreePath ?? project.value.workspaceRoot;
  },
);
