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

const skill = (name: string): ServerProviderSkill => ({
  name,
  path: `/workspace/.agents/skills/${name}/SKILL.md`,
  enabled: true,
  scope: "repo",
});

describe("ProviderSkillLookup", () => {
  it.effect("re-resolves a selected skill against the persisted worktree", () =>
    Effect.gen(function* () {
      const seenCwds: string[] = [];
      const instance = {
        snapshotForCwd: (cwd: string) =>
          Effect.sync(() => {
            seenCwds.push(cwd);
            return { skills: [skill("from-worktree")] };
          }),
      } as unknown as ProviderInstance;
      const lookup = yield* makeProviderSkillLookup({
        getProject: () =>
          Effect.succeed(Option.some({ id: projectA, workspaceRoot: "/project-a" })),
        getThread: () =>
          Effect.succeed(Option.some({ projectId: projectA, worktreePath: "/worktrees/a" })),
        getInstance: () => Effect.succeed(instance),
      });

      const skills = yield* lookup.resolveNames({
        instanceId: codex,
        projectId: projectA,
        threadId: threadA,
        names: ["from-worktree"],
      });

      assert.deepEqual(skills, [skill("from-worktree")]);
      assert.deepEqual(seenCwds, ["/worktrees/a"]);
    }),
  );

  it.effect("rejects a forged thread/project pairing before probing a provider", () =>
    Effect.gen(function* () {
      let probed = false;
      const instance = {
        snapshotForCwd: () =>
          Effect.sync(() => {
            probed = true;
            return { skills: [skill("review")] };
          }),
      } as unknown as ProviderInstance;
      const lookup = yield* makeProviderSkillLookup({
        getProject: () =>
          Effect.succeed(Option.some({ id: projectA, workspaceRoot: "/project-a" })),
        getThread: () =>
          Effect.succeed(Option.some({ projectId: projectB, worktreePath: "/project-b" })),
        getInstance: () => Effect.succeed(instance),
      });

      const error = yield* lookup
        .resolveNames({
          instanceId: codex,
          projectId: projectA,
          threadId: threadB,
          names: ["review"],
        })
        .pipe(Effect.flip);

      assert.match(error.message, /does not belong/);
      assert.isFalse(probed);
    }),
  );

  it.effect("blocks a selected skill that disappeared before send", () =>
    Effect.gen(function* () {
      const instance = {
        snapshotForCwd: () => Effect.succeed({ skills: [] }),
      } as unknown as ProviderInstance;
      const lookup = yield* makeProviderSkillLookup({
        getProject: () =>
          Effect.succeed(Option.some({ id: projectA, workspaceRoot: "/project-a" })),
        getThread: () => Effect.succeed(Option.some({ projectId: projectA, worktreePath: null })),
        getInstance: () => Effect.succeed(instance),
      });

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
