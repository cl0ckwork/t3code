/**
 * ProviderSkillLookup — workspace-scoped provider skill discovery.
 *
 * The browser supplies stable project/thread ids and a provider instance id;
 * this module derives the cwd exclusively from the persisted projection. That
 * keeps a remote client from making provider subprocesses inspect arbitrary
 * paths on the server.
 */
import {
  type ProjectId,
  type ProviderInstanceId,
  type ServerProviderSkill,
  ServerProviderSkillLookupError,
  type ServerProviderSkillLookupInput,
  type ThreadId,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Cache from "effect/Cache";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";

import type { ProviderInstance } from "./ProviderDriver.ts";

const LOOKUP_TIMEOUT = Duration.seconds(10);
const INVENTORY_CACHE_TTL = Duration.seconds(10);
const INVENTORY_CACHE_CAPACITY = 512;

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

function inventoryCacheKey(input: {
  readonly instanceId: ProviderInstanceId;
  readonly projectId: ProjectId;
  readonly threadId: ThreadId | undefined;
  readonly cwd: string;
}): string {
  // The map is owned by one server environment. Including the workspace in
  // addition to the ids prevents a recreated project/thread from receiving a
  // stale inventory before its old cache entry expires.
  return JSON.stringify([input.instanceId, input.projectId, input.threadId ?? null, input.cwd]);
}

function inventoryInputFromCacheKey(cacheKey: string): {
  readonly instanceId: ProviderInstanceId;
  readonly projectId: ProjectId;
  readonly threadId: ThreadId | undefined;
  readonly cwd: string;
} {
  // Cache keys only originate in inventoryCacheKey. JSON cannot preserve the
  // branded id types, so restore them after deserializing this internal value.
  const [instanceId, projectId, threadId, cwd] = JSON.parse(cacheKey) as [
    string,
    string,
    string | null,
    string,
  ];
  return {
    instanceId: instanceId as ProviderInstanceId,
    projectId: projectId as ProjectId,
    threadId: threadId === null ? undefined : (threadId as ThreadId),
    cwd,
  };
}

function skillLookupLogAnnotations(input: {
  readonly instanceId: ProviderInstanceId;
  readonly projectId: ProjectId;
  readonly threadId?: ThreadId | undefined;
  readonly cwd?: string | undefined;
}): Readonly<Record<string, string>> {
  return {
    "provider-skill.instance-id": input.instanceId,
    "provider-skill.project-id": input.projectId,
    ...(input.threadId === undefined ? {} : { "provider-skill.thread-id": input.threadId }),
    ...(input.cwd === undefined ? {} : { "provider-skill.cwd": input.cwd }),
  };
}

function logProviderSkillLookup(
  message: string,
  input: Parameters<typeof skillLookupLogAnnotations>[0],
): Effect.Effect<void> {
  return Effect.logDebug(message).pipe(Effect.annotateLogs(skillLookupLogAnnotations(input)));
}

function workspaceSkillPrecedence(skill: ServerProviderSkill): number {
  const normalizedPath = skill.path.replaceAll("\\", "/").toLowerCase();
  if (normalizedPath.includes("/.claude/skills/")) {
    return 2;
  }
  if (normalizedPath.includes("/.agents/skills/")) {
    return 1;
  }
  return 0;
}

/**
 * Providers can report the same logical skill through several discovery
 * roots. The picker and send-time lookup must agree on one canonical record:
 * user/global < .agents/skills < .claude/skills.
 */
function deduplicateProviderSkills(
  skills: ReadonlyArray<ServerProviderSkill>,
): ReadonlyArray<ServerProviderSkill> {
  const byName = new Map<string, ServerProviderSkill>();
  for (const skill of skills) {
    const existing = byName.get(skill.name);
    if (!existing || workspaceSkillPrecedence(skill) > workspaceSkillPrecedence(existing)) {
      byName.set(skill.name, skill);
    }
  }
  return [...byName.values()];
}

export interface ProviderSkillLookup {
  readonly list: (
    input: ServerProviderSkillLookupInput,
  ) => Effect.Effect<ReadonlyArray<ServerProviderSkill>, ServerProviderSkillLookupError>;
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
  const resolveWorkspace = Effect.fn("ProviderSkillLookup.resolveWorkspace")(function* (
    input: Pick<ServerProviderSkillLookupInput, "projectId" | "threadId">,
  ) {
    yield* Effect.logDebug("Resolving workspace for provider skill lookup").pipe(
      Effect.annotateLogs({
        "provider-skill.project-id": input.projectId,
        ...(input.threadId === undefined ? {} : { "provider-skill.thread-id": input.threadId }),
      }),
    );
    const project = yield* dependencies.getProject(input.projectId);
    if (Option.isNone(project)) {
      yield* Effect.logWarning("Provider skill lookup project was not found").pipe(
        Effect.annotateLogs({ "provider-skill.project-id": input.projectId }),
      );
      return yield* lookupError(`Project '${input.projectId}' was not found.`);
    }
    if (input.threadId === undefined) {
      yield* Effect.logDebug("Resolved provider skill lookup to project root").pipe(
        Effect.annotateLogs({
          "provider-skill.project-id": input.projectId,
          "provider-skill.cwd": project.value.workspaceRoot,
        }),
      );
      return { cwd: project.value.workspaceRoot, threadId: undefined };
    }
    const thread = yield* dependencies.getThread(input.threadId);
    if (Option.isNone(thread)) {
      // A client can hold a just-created or stale thread id while the server
      // projection has no matching row yet. Falling back to the persisted
      // project root remains safe: no client filesystem path is accepted and
      // a real thread from another project is still rejected below.
      yield* Effect.logWarning(
        "Provider skill lookup thread was not found; using project root",
      ).pipe(
        Effect.annotateLogs({
          "provider-skill.project-id": input.projectId,
          "provider-skill.thread-id": input.threadId,
          "provider-skill.cwd": project.value.workspaceRoot,
        }),
      );
      return { cwd: project.value.workspaceRoot, threadId: undefined };
    }
    if (thread.value.projectId !== project.value.id) {
      yield* Effect.logWarning("Provider skill lookup rejected a thread from another project").pipe(
        Effect.annotateLogs({
          "provider-skill.project-id": input.projectId,
          "provider-skill.thread-id": input.threadId,
          "provider-skill.thread-project-id": thread.value.projectId,
        }),
      );
      return yield* lookupError(
        `Thread '${input.threadId}' does not belong to project '${input.projectId}'.`,
      );
    }
    const cwd = thread.value.worktreePath ?? project.value.workspaceRoot;
    yield* Effect.logDebug("Resolved provider skill lookup workspace").pipe(
      Effect.annotateLogs({
        "provider-skill.project-id": input.projectId,
        "provider-skill.thread-id": input.threadId,
        "provider-skill.cwd": cwd,
      }),
    );
    return {
      cwd,
      threadId: input.threadId,
    };
  });

  const listUncached = Effect.fn("ProviderSkillLookup.listUncached")(function* (cacheKey: string) {
    const input = inventoryInputFromCacheKey(cacheKey);
    const instance = yield* dependencies.getInstance(input.instanceId);
    if (instance === undefined) {
      yield* logProviderSkillLookup("Provider skill lookup provider instance was unavailable", {
        ...input,
      });
      return yield* lookupError(`Provider instance '${input.instanceId}' is not available.`);
    }

    const globalFallback = instance.snapshot.getSnapshot.pipe(
      Effect.map((snapshot) => snapshot.skills),
      Effect.tap((skills) =>
        logProviderSkillLookup("Provider skill lookup used global snapshot fallback", {
          ...input,
        }).pipe(Effect.annotateLogs({ "provider-skill.count": String(skills.length) })),
      ),
      Effect.catchCause((cause) =>
        Effect.logWarning("Provider skill lookup global snapshot fallback failed").pipe(
          Effect.annotateLogs({
            ...skillLookupLogAnnotations(input),
            "provider-skill.cause": Cause.pretty(cause),
          }),
          Effect.as([]),
        ),
      ),
    );
    const scopedInventory = instance.snapshotForCwd
      ? instance.snapshotForCwd(input.cwd).pipe(
          Effect.timeoutOption(LOOKUP_TIMEOUT),
          Effect.map(Option.map((snapshot) => snapshot.skills)),
          Effect.tap(
            Option.match({
              onNone: () =>
                logProviderSkillLookup("Provider skill lookup timed out", {
                  ...input,
                }),
              onSome: (skills) =>
                logProviderSkillLookup("Provider skill lookup completed", {
                  ...input,
                }).pipe(Effect.annotateLogs({ "provider-skill.count": String(skills.length) })),
            }),
          ),
          Effect.catchCause((cause) =>
            Effect.logWarning("Provider skill lookup provider probe failed").pipe(
              Effect.annotateLogs({
                ...skillLookupLogAnnotations(input),
                "provider-skill.cause": Cause.pretty(cause),
              }),
              Effect.as(Option.none()),
            ),
          ),
        )
      : instance.skills
        ? instance.skills.list(input.cwd).pipe(
          Effect.scoped,
          Effect.timeoutOption(LOOKUP_TIMEOUT),
          Effect.tap(
            Option.match({
              onNone: () =>
                logProviderSkillLookup("Provider skill lookup timed out", {
                  ...input,
                }),
              onSome: (skills) =>
                logProviderSkillLookup("Provider skill lookup completed", {
                  ...input,
                }).pipe(Effect.annotateLogs({ "provider-skill.count": String(skills.length) })),
            }),
          ),
          Effect.catchCause((cause) =>
            Effect.logWarning("Provider skill lookup provider probe failed").pipe(
              Effect.annotateLogs({
                ...skillLookupLogAnnotations(input),
                "provider-skill.cause": Cause.pretty(cause),
              }),
              Effect.as(Option.none()),
            ),
          ),
        )
      : Effect.logDebug("Provider has no workspace skill discovery implementation").pipe(
          Effect.annotateLogs(skillLookupLogAnnotations(input)),
          Effect.as(Option.none<ReadonlyArray<ServerProviderSkill>>()),
        );
    const scopedSkills = yield* scopedInventory;
    const discoveredSkills = Option.isSome(scopedSkills)
      ? scopedSkills.value
      : yield* globalFallback;
    const skills = deduplicateProviderSkills(discoveredSkills);

    yield* logProviderSkillLookup("Provider skill lookup completed inventory", {
      ...input,
    }).pipe(
      Effect.annotateLogs({
        "provider-skill.count": String(skills.length),
        "provider-skill.duplicates-removed": String(discoveredSkills.length - skills.length),
      }),
    );
    return skills;
  });

  // Cache owns expiry and singleflight behavior, so identical picker reads
  // share one provider probe and never leave hand-rolled clock state behind.
  const inventoryCache = yield* Cache.makeWith(listUncached, {
    capacity: INVENTORY_CACHE_CAPACITY,
    timeToLive: (exit) => (Exit.isSuccess(exit) ? INVENTORY_CACHE_TTL : Duration.zero),
  });

  const listInventory = Effect.fn("ProviderSkillLookup.listInventory")(function* (
    input: ServerProviderSkillLookupInput,
    workspace: { readonly cwd: string; readonly threadId: ThreadId | undefined },
  ) {
    const cacheKey = inventoryCacheKey({ ...input, ...workspace });
    const cached = yield* Cache.getOption(inventoryCache, cacheKey);
    if (Option.isSome(cached)) {
      yield* logProviderSkillLookup("Provider skill lookup cache hit", {
        ...input,
        ...workspace,
      }).pipe(Effect.annotateLogs({ "provider-skill.count": String(cached.value.length) }));
      return cached.value;
    }
    return yield* Cache.get(inventoryCache, cacheKey);
  });

  const list = Effect.fn("ProviderSkillLookup.list")(function* (
    input: ServerProviderSkillLookupInput,
  ) {
    const workspace = yield* resolveWorkspace(input);
    return yield* listInventory(input, workspace);
  });

  const resolveNames = Effect.fn("ProviderSkillLookup.resolveNames")(function* (input: {
    readonly instanceId: ProviderInstanceId;
    readonly projectId: ProjectId;
    readonly threadId: ThreadId;
    readonly names: ReadonlyArray<string>;
  }) {
    const normalizedNames = [...new Set(input.names.map((name) => name.trim()).filter(Boolean))];
    if (normalizedNames.length === 0) {
      return [];
    }
    // A picker result is allowed to be briefly cached, but attaching a skill
    // changes the provider request. Re-read at send time so a deleted or
    // disabled workspace skill cannot become inert text in a Codex turn.
    yield* logProviderSkillLookup("Resolving selected provider skills before send", input).pipe(
      Effect.annotateLogs({ "provider-skill.names": normalizedNames.join(",") }),
    );
    const workspace = yield* resolveWorkspace(input);
    const cacheKey = inventoryCacheKey({ ...input, ...workspace });
    yield* Cache.invalidate(inventoryCache, cacheKey);
    const skills = yield* listInventory(input, workspace);
    const byName = new Map(skills.map((skill) => [skill.name, skill] as const));
    const unavailableName = normalizedNames.find((name) => !byName.get(name)?.enabled);
    if (unavailableName) {
      yield* logProviderSkillLookup("Selected provider skill is unavailable", input).pipe(
        Effect.annotateLogs({ "provider-skill.name": unavailableName }),
      );
      return yield* lookupError(
        `Skill '$${unavailableName}' is no longer available in this workspace. Refresh the picker and try again.`,
      );
    }
    return normalizedNames.flatMap((name) => {
      const skill = byName.get(name);
      return skill ? [skill] : [];
    });
  });

  return { list, resolveNames };
});
