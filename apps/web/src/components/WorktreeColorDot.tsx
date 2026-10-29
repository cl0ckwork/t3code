import type { EnvironmentId } from "@t3tools/contracts";
import { cn } from "~/lib/utils";
import { useWorktreeColor } from "../state/worktreeColors";

export function worktreeColorVar(color: number): string {
  return `var(--worktree-${color})`;
}

/** Decorative: a text label beside it always names the worktree. */
export function WorktreeColorDot(props: {
  environmentId: EnvironmentId;
  worktreePath: string | null;
  className?: string;
}) {
  const color = useWorktreeColor(props.environmentId, props.worktreePath);
  if (color === null) return null;
  return (
    <span
      aria-hidden
      className={cn("inline-block size-2 shrink-0 rounded-full", props.className)}
      style={{ backgroundColor: worktreeColorVar(color) }}
    />
  );
}
