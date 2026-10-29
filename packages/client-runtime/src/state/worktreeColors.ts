import type { EnvironmentId } from "@t3tools/contracts";
import { isTemporaryWorktreeBranch } from "@t3tools/shared/git";
import { fileBasename } from "@t3tools/shared/path";
import type { EnvironmentThreadShell } from "./models.ts";

export const WORKTREE_COLOR_COUNT = 12;

type WorktreeColorThread = Pick<
  EnvironmentThreadShell,
  "environmentId" | "worktreePath" | "createdAt" | "archivedAt" | "deletedAt" | "settledOverride"
>;

export function worktreeColorKey(environmentId: EnvironmentId, worktreePath: string): string {
  return `${environmentId}\u0000${worktreePath}`;
}

export function hashedWorktreeColor(key: string): number {
  // FNV-1a: tiny, and every client gets the same slot for the same key.
  let hash = 0x811c9dc5;
  for (let index = 0; index < key.length; index++) {
    hash = Math.imul(hash ^ key.charCodeAt(index), 0x01000193);
  }
  return (hash >>> 0) % WORKTREE_COLOR_COUNT;
}

/**
 * Gives each worktree with an unsettled thread its own colour while there are
 * at most `WORKTREE_COLOR_COUNT` of them. Older worktrees claim first, so one
 * opening never recolours an older one. A worktree with only settled threads
 * keeps its plain hashed colour.
 */
export function assignWorktreeColors(
  threads: ReadonlyArray<WorktreeColorThread>,
): ReadonlyMap<string, number> {
  const firstCreatedAt = new Map<string, string>();
  const open = new Set<string>();
  for (const thread of threads) {
    const path = thread.worktreePath?.trim();
    if (!path || thread.deletedAt !== null) continue;
    const key = worktreeColorKey(thread.environmentId, path);
    const known = firstCreatedAt.get(key);
    if (known === undefined || thread.createdAt < known) firstCreatedAt.set(key, thread.createdAt);
    if (thread.archivedAt === null && thread.settledOverride !== "settled") open.add(key);
  }

  const colors = new Map<string, number>();
  const used = new Set<number>();
  const openByAge = [...open].sort((left, right) => {
    const byAge = firstCreatedAt.get(left)!.localeCompare(firstCreatedAt.get(right)!);
    return byAge !== 0 ? byAge : left.localeCompare(right);
  });
  for (const key of openByAge) {
    const preferred = hashedWorktreeColor(key);
    let color = preferred;
    for (let step = 0; step < WORKTREE_COLOR_COUNT && used.has(color); step++) {
      color = (preferred + step + 1) % WORKTREE_COLOR_COUNT;
    }
    if (used.has(color)) color = preferred;
    used.add(color);
    colors.set(key, color);
  }
  for (const key of firstCreatedAt.keys()) {
    if (!colors.has(key)) colors.set(key, hashedWorktreeColor(key));
  }
  return colors;
}

/** A real branch names the worktree; a temporary one says nothing, so the folder does. */
export function worktreeLabel(input: {
  readonly branch: string | null;
  readonly worktreePath: string;
}): string {
  const branch = input.branch?.trim();
  if (branch && !isTemporaryWorktreeBranch(branch)) return branch;
  return fileBasename(input.worktreePath) || input.worktreePath;
}
