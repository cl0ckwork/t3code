import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  assignWorktreeColors,
  hashedWorktreeColor,
  WORKTREE_COLOR_COUNT,
  worktreeColorKey,
  worktreeLabel,
} from "./worktreeColors.ts";

const LOCAL = EnvironmentId.make("local");
const REMOTE = EnvironmentId.make("remote");

function thread(
  worktreePath: string | null,
  createdAt: string,
  overrides: {
    readonly environmentId?: EnvironmentId;
    readonly settled?: boolean;
    readonly archived?: boolean;
  } = {},
) {
  return {
    environmentId: overrides.environmentId ?? LOCAL,
    worktreePath,
    createdAt,
    archivedAt: overrides.archived ? createdAt : null,
    deletedAt: null,
    settledOverride: overrides.settled ? ("settled" as const) : null,
  };
}

function day(index: number): string {
  return `2026-10-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`;
}

describe("assignWorktreeColors", () => {
  it("gives every open worktree its own colour while the palette has room", () => {
    const threads = Array.from({ length: WORKTREE_COLOR_COUNT }, (_, index) =>
      thread(`/worktrees/w${index}`, day(index)),
    );
    const colors = assignWorktreeColors(threads);
    expect(new Set(colors.values()).size).toBe(WORKTREE_COLOR_COUNT);
  });

  it("keeps an older worktree's colour when a newer one opens or closes", () => {
    const older = Array.from({ length: 6 }, (_, index) =>
      thread(`/worktrees/w${index}`, day(index)),
    );
    const before = assignWorktreeColors(older);
    const withNewer = assignWorktreeColors([...older, thread("/worktrees/newer", day(10))]);
    const newerSettled = assignWorktreeColors([
      ...older,
      thread("/worktrees/newer", day(10), { settled: true }),
    ]);
    for (const [key, color] of before) {
      expect(withNewer.get(key)).toBe(color);
      expect(newerSettled.get(key)).toBe(color);
    }
  });

  it("orders claims by a worktree's first thread, not by input order", () => {
    const threads = [
      thread("/worktrees/b", day(3)),
      thread("/worktrees/a", day(5)),
      thread("/worktrees/a", day(1)),
    ];
    expect(assignWorktreeColors(threads)).toEqual(assignWorktreeColors([...threads].reverse()));
  });

  it("gives a worktree with only settled or archived threads its hashed colour", () => {
    const settledKey = worktreeColorKey(LOCAL, "/worktrees/settled");
    const archivedKey = worktreeColorKey(LOCAL, "/worktrees/archived");
    const colors = assignWorktreeColors([
      thread("/worktrees/settled", day(0), { settled: true }),
      thread("/worktrees/archived", day(1), { archived: true }),
    ]);
    expect(colors.get(settledKey)).toBe(hashedWorktreeColor(settledKey));
    expect(colors.get(archivedKey)).toBe(hashedWorktreeColor(archivedKey));
  });

  it("treats one path on two environments as two worktrees and skips root checkouts", () => {
    const colors = assignWorktreeColors([
      thread("/worktrees/same", day(0)),
      thread("/worktrees/same", day(1), { environmentId: REMOTE }),
      thread(null, day(2)),
      thread("  ", day(3)),
    ]);
    expect(colors.size).toBe(2);
    expect(colors.get(worktreeColorKey(LOCAL, "/worktrees/same"))).not.toBe(
      colors.get(worktreeColorKey(REMOTE, "/worktrees/same")),
    );
  });
});

describe("worktreeLabel", () => {
  it.each([
    ["luke2/feature/pog-2712", "/w/t3-47f6a839", "luke2/feature/pog-2712"],
    [null, "/w/t3code-71cb579e", "t3code-71cb579e"],
    ["t3code/71cb579e", "/w/t3code-71cb579e", "t3code-71cb579e"],
  ])("labels branch %s at %s as %s", (branch, worktreePath, label) => {
    expect(worktreeLabel({ branch, worktreePath })).toBe(label);
  });
});
