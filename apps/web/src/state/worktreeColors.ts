import { useAtomValue } from "@effect/atom-react";
import {
  assignWorktreeColors,
  hashedWorktreeColor,
  worktreeColorKey,
} from "@t3tools/client-runtime/state/worktree-colors";
import type { EnvironmentId } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { environmentThreadShells } from "./threads";

const worktreeColorsAtom = Atom.make((get) =>
  assignWorktreeColors(get(environmentThreadShells.quietThreadShellsAtom)),
).pipe(Atom.withLabel("worktree-colors"));

// A number per key, so a mark re-renders only when its own colour changes.
const worktreeColorAtom = Atom.family((key: string) =>
  Atom.make((get) => get(worktreeColorsAtom).get(key) ?? hashedWorktreeColor(key)).pipe(
    Atom.withLabel(`worktree-color:${key}`),
  ),
);

const NO_WORKTREE_COLOR_ATOM = Atom.make<number | null>(null).pipe(
  Atom.withLabel("worktree-color:none"),
);

export function useWorktreeColor(
  environmentId: EnvironmentId | null,
  worktreePath: string | null,
): number | null {
  const path = worktreePath?.trim();
  return useAtomValue(
    environmentId && path
      ? worktreeColorAtom(worktreeColorKey(environmentId, path))
      : NO_WORKTREE_COLOR_ATOM,
  );
}
