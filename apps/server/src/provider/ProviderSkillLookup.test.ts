import { assert, describe, it } from "@effect/vitest";
import {
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type ServerProviderSkill,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import type { ProviderInstance } from "./ProviderDriver.ts";
import { makeProviderSkillLookup } from "./ProviderSkillLookup.ts";

const projectA = ProjectId.make("project-a");
const projectB = ProjectId.make("project-b");
const threadA = ThreadId.make("thread-a");
const threadB = ThreadId.make("thread-b");
const codex = ProviderInstanceId.make("codex");

const skill = (name: string, path: string): ServerProviderSkill => ({
  name,
  path,
  enabled: true,
  scope: "repo",
});

describe("ProviderSkillLookup", () => {
  it.effect("isolates inventories by persisted project and attached worktree", () =>
    Effect.gen(function* () {
      const seenCwds: string[] = [];
      const instance = {
        skills: {
          list: (cwd: string) =>
            Effect.sync(() => {
              seenCwds.push(cwd);
              return cwd === "/worktrees/a"
                ? [skill("from-worktree", "/worktrees/a/.agents/skills/from-worktree/SKILL.md")]
                : [skill("from-project-b", "/project-b/.agents/skills/from-project-b/SKILL.md")];
            }),
        },
        snapshot: { getSnapshot: Effect.succeed({ skills: [] }) },
      } as unknown as ProviderInstance;
      const lookup = yield* makeProviderSkillLookup({
        getProject: (projectId) =>
          Effect.succeed(
            Option.some(
              projectId === projectA
                ? { id: projectA, workspaceRoot: "/project-a" }
                : { id: projectB, workspaceRoot: "/project-b" },
            ),
          ),
        getThread: (threadId) =>
          Effect.succeed(
            Option.some(
              threadId === threadA
                ? { projectId: projectA, worktreePath: "/worktrees/a" }
                : { projectId: projectB, worktreePath: null },
            ),
          ),
        getInstance: () => Effect.succeed(instance),
      });

      const worktreeSkills = yield* lookup.list({
        instanceId: codex,
        projectId: projectA,
        threadId: threadA,
      });
      const projectSkills = yield* lookup.list({
        instanceId: codex,
        projectId: projectB,
        threadId: threadB,
      });

      assert.deepEqual(
        worktreeSkills.map((entry) => entry.name),
        ["from-worktree"],
      );
      assert.deepEqual(
        projectSkills.map((entry) => entry.name),
        ["from-project-b"],
      );
      assert.deepEqual(seenCwds, ["/worktrees/a", "/project-b"]);
    }),
  );

  it.effect("rejects a forged thread/project pairing before probing a provider", () =>
    Effect.gen(function* () {
      let listed = false;
      const instance = {
        skills: {
          list: () =>
            Effect.sync(() => {
              listed = true;
              return [];
            }),
        },
        snapshot: { getSnapshot: Effect.succeed({ skills: [] }) },
      } as unknown as ProviderInstance;
      const lookup = yield* makeProviderSkillLookup({
        getProject: () =>
          Effect.succeed(Option.some({ id: projectA, workspaceRoot: "/project-a" })),
        getThread: () =>
          Effect.succeed(Option.some({ projectId: projectB, worktreePath: "/project-b" })),
        getInstance: () => Effect.succeed(instance),
      });

      const error = yield* lookup
        .list({ instanceId: codex, projectId: projectA, threadId: threadB })
        .pipe(Effect.flip);

      assert.match(error.message, /does not belong/);
      assert.isFalse(listed);
    }),
  );

  it.effect("uses the persisted project root when a client thread is not projected yet", () =>
    Effect.gen(function* () {
      const seenCwds: string[] = [];
      const instance = {
        skills: {
          list: (cwd: string) =>
            Effect.sync(() => {
              seenCwds.push(cwd);
              return [skill("project-root", `${cwd}/.agents/skills/project-root/SKILL.md`)];
            }),
        },
        snapshot: { getSnapshot: Effect.succeed({ skills: [] }) },
      } as unknown as ProviderInstance;
      const lookup = yield* makeProviderSkillLookup({
        getProject: () =>
          Effect.succeed(Option.some({ id: projectA, workspaceRoot: "/project-a" })),
        getThread: () => Effect.succeed(Option.none()),
        getInstance: () => Effect.succeed(instance),
      });

      const skills = yield* lookup.list({
        instanceId: codex,
        projectId: projectA,
        threadId: threadA,
      });

      assert.deepEqual(
        skills.map((entry) => entry.name),
        ["project-root"],
      );
      assert.deepEqual(seenCwds, ["/project-a"]);
    }),
  );

  it.effect("deduplicates provider results with workspace skill precedence", () =>
    Effect.gen(function* () {
      const instance = {
        skills: {
          list: () =>
            Effect.succeed([
              skill("review", "/Users/me/.codex/skills/review/SKILL.md"),
              skill("review", "/project-a/.agents/skills/review/SKILL.md"),
              skill("review", "/project-a/.claude/skills/review/SKILL.md"),
            ]),
        },
        snapshot: { getSnapshot: Effect.succeed({ skills: [] }) },
      } as unknown as ProviderInstance;
      const lookup = yield* makeProviderSkillLookup({
        getProject: () =>
          Effect.succeed(Option.some({ id: projectA, workspaceRoot: "/project-a" })),
        getThread: () => Effect.succeed(Option.some({ projectId: projectA, worktreePath: null })),
        getInstance: () => Effect.succeed(instance),
      });

      const skills = yield* lookup.list({
        instanceId: codex,
        projectId: projectA,
        threadId: threadA,
      });
      assert.deepEqual(skills, [skill("review", "/project-a/.claude/skills/review/SKILL.md")]);
    }),
  );

  it.effect("rejects a selected skill that disappeared before send", () =>
    Effect.gen(function* () {
      let skillStillExists = true;
      const instance = {
        skills: {
          list: () =>
            Effect.sync(() =>
              skillStillExists ? [skill("still-here", "/project-a/still-here")] : [],
            ),
        },
        snapshot: { getSnapshot: Effect.succeed({ skills: [] }) },
      } as unknown as ProviderInstance;
      const lookup = yield* makeProviderSkillLookup({
        getProject: () =>
          Effect.succeed(Option.some({ id: projectA, workspaceRoot: "/project-a" })),
        getThread: () => Effect.succeed(Option.some({ projectId: projectA, worktreePath: null })),
        getInstance: () => Effect.succeed(instance),
      });

      assert.deepEqual(
        (yield* lookup.list({ instanceId: codex, projectId: projectA, threadId: threadA })).map(
          (entry) => entry.name,
        ),
        ["still-here"],
      );
      skillStillExists = false;

      const error = yield* lookup
        .resolveNames({
          instanceId: codex,
          projectId: projectA,
          threadId: threadA,
          names: ["deleted-skill"],
        })
        .pipe(Effect.flip);

      assert.match(error.message, /no longer available/);
    }),
  );
});
