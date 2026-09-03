/**
 * Resolve explicit Codex skill mentions immediately before dispatch.
 *
 * Picker inventory is owned by ProviderRegistry workspace snapshots. This
 * boundary exists only because a Codex skill must be attached as structured
 * provider input, and an older picker result can be stale by send time.
 */
import {
  type ProjectId,
  type ProviderInstanceId,
  type ServerProviderSkill,
  ServerProviderSkillLookupError,
  type ThreadId,
} from "@t3tools/contracts";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import type { ProviderInstance } from "./ProviderDriver.ts";

const LOOKUP_TIMEOUT = Duration.seconds(10);

export interface ProviderSkillLookupDependencies {
  readonly getProject: (projectId: ProjectId) => Effect.Effect<
    Option.Option<{
      readonly id: ProjectId;
      readonly workspaceRoot: string;
    }>,
    ServerProviderSkillLookupError
  >;
  readonly getThread: (threadId: ThreadId) => Effect.Effect<
    Option.Option<{
      readonly projectId: ProjectId;
      readonly worktreePath: string | null;
    }>,
    ServerProviderSkillLookupError
  >;
  readonly getInstance: (
    instanceId: ProviderInstanceId,
  ) => Effect.Effect<ProviderInstance | undefined, ServerProviderSkillLookupError>;
}

function lookupError(message: string): ServerProviderSkillLookupError {
  return new ServerProviderSkillLookupError({ message });
}

export interface ProviderSkillLookup {
  readonly resolveNames: (input: {
    readonly instanceId: ProviderInstanceId;
    readonly projectId: ProjectId;
    readonly threadId: ThreadId;
    readonly names: ReadonlyArray<string>;
  }) => Effect.Effect<ReadonlyArray<ServerProviderSkill>, ServerProviderSkillLookupError>;
}

export const makeProviderSkillLookup = Effect.fn("ProviderSkillLookup.make")(function* (
  dependencies: ProviderSkillLookupDependencies,
) {
  const resolveNames = Effect.fn("ProviderSkillLookup.resolveNames")(function* (input: {
    readonly instanceId: ProviderInstanceId;
    readonly projectId: ProjectId;
    readonly threadId: ThreadId;
    readonly names: ReadonlyArray<string>;
  }) {
    const names = [...new Set(input.names.map((name) => name.trim()).filter(Boolean))];
    if (names.length === 0) {
      return [];
    }

    const project = yield* dependencies.getProject(input.projectId);
    if (Option.isNone(project)) {
      return yield* lookupError(`Project '${input.projectId}' was not found.`);
    }
    const thread = yield* dependencies.getThread(input.threadId);
    if (Option.isNone(thread)) {
      return yield* lookupError(`Thread '${input.threadId}' was not found.`);
    }
    if (thread.value.projectId !== project.value.id) {
      return yield* lookupError(
        `Thread '${input.threadId}' does not belong to project '${input.projectId}'.`,
      );
    }

    const instance = yield* dependencies.getInstance(input.instanceId);
    if (instance === undefined) {
      return yield* lookupError(`Provider instance '${input.instanceId}' is not available.`);
    }
    if (!instance.snapshotForCwd) {
      return yield* lookupError(
        `Provider instance '${input.instanceId}' cannot resolve workspace skills.`,
      );
    }

    const cwd = thread.value.worktreePath ?? project.value.workspaceRoot;
    const snapshot = yield* instance.snapshotForCwd(cwd).pipe(
      Effect.timeoutOption(LOOKUP_TIMEOUT),
      Effect.mapError(() =>
        lookupError(
          `Could not resolve skills for the current workspace. Refresh the picker and try again.`,
        ),
      ),
    );
    if (Option.isNone(snapshot)) {
      return yield* lookupError(
        `Skill lookup timed out for the current workspace. Refresh the picker and try again.`,
      );
    }

    const skillsByName = new Map(
      snapshot.value.skills.map((skill) => [skill.name, skill] as const),
    );
    const unavailableName = names.find((name) => !skillsByName.get(name)?.enabled);
    if (unavailableName) {
      return yield* lookupError(
        `Skill '$${unavailableName}' is no longer available in this workspace. Refresh the picker and try again.`,
      );
    }
    return names.flatMap((name) => {
      const skill = skillsByName.get(name);
      return skill ? [skill] : [];
    });
  });

  return { resolveNames };
});
